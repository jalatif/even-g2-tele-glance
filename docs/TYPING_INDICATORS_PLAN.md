# Real Telegram Typing Indicators — Implementation Plan

## Summary

Show "X is typing…" in the footer when another user is typing inside the currently-open message view. Telethon delivers `ChatAction` events; the backend normalizes them into a new `TypingUpdate` DTO, the SSE stream delivers them, and the controller renders them in the `panelFooter` with an auto-clear timeout.

---

## 1. Backend: New DTO (`server/app/models.py`)

Add `TypingUpdate` to the models:

```py
class TypingUpdate(ApiModel):
    type: Literal["typing"] = "typing"
    chat_id: int
    topic_id: Optional[int] = None
    user_name: Optional[str] = None
    action: Literal["typing", "cancel"] = "typing"
```

Also add it to the import list in `telegram.py` and `main.py`.

---

## 2. Backend: Telethon ChatAction Handler (`server/app/services/telegram.py`)

### 2a. Register event handler

In `_ensure_update_handler()`:
```py
from telethon import events
self._client.add_event_handler(self._handle_chat_action, events.ChatAction())
```

### 2b. Handler method

```py
async def _handle_chat_action(self, event: Any) -> None:
    if not self._update_queues:
        return
    update = normalize_chat_action(event)
    if update is None:
        return
    for queue in list(self._update_queues):
        try:
            queue.put_nowait(update)
        except asyncio.QueueFull:
            pass
```

### 2c. Normalization function

```py
def normalize_chat_action(event: Any) -> Optional[TypingUpdate]:
    action = getattr(event, "action_message", None)
    if action is None:
        return None
    action_type = type(action.action).__name__
    if action_type == "SendMessageTypingAction":
        typing = "typing"
    elif action_type == "SendMessageCancelAction":
        typing = "cancel"
    else:
        return None  # ignore record-audio, upload-photo, etc.
    
    user = getattr(event, "user", None)
    user_name = user.first_name if user else None
    
    chat_id = getattr(event, "chat_id", None)
    topic_id = _chat_action_topic_id(action)
    
    return TypingUpdate(
        chat_id=chat_id,
        topic_id=topic_id,
        user_name=user_name,
        action=typing,
    )

def _chat_action_topic_id(action: Any) -> Optional[int]:
    reply_to = getattr(action, "reply_to", None)
    if reply_to is None:
        return None
    # Forum topics carry reply_to.reply_to_msg_id → topMessageId
    return getattr(reply_to, "reply_to_msg_id", None)
```

### 2d. Widen queue type

```py
# Before
self._update_queues: set[asyncio.Queue[TelegramUpdate]] = set()

# After
self._update_queues: set[asyncio.Queue[TelegramUpdate | TypingUpdate]] = set()
```

### 2e. Widen `update_events()` return type

```py
async def update_events(self) -> AsyncIterator[TelegramUpdate | TypingUpdate]:
```

### 2f. Update protocol

`TelegramService` protocol's `update_events()` also needs the union return type. And import `TypingUpdate` at the top of the file.

---

## 3. Backend: SSE Streaming (`server/app/main.py`)

The `stream_updates` endpoint generator needs to handle `TypingUpdate`:

```py
async def events():
    try:
        async for update in telegram.update_events():
            if isinstance(update, TypingUpdate):
                payload = update.model_dump_json(by_alias=True)
                yield f"event: typing\ndata: {event_data(payload)}\n\n"
            else:
                payload = update.model_dump_json(by_alias=True)
                yield f"event: message\ndata: {event_data(payload)}\n\n"
    except TelegramServiceError as exc:
        ...
```

Also import `TypingUpdate` in `main.py`.

---

## 4. Frontend: Types (`web/src/types.ts`)

Add:

```ts
export type TelegramTypingUpdate = {
  type: 'typing'
  chatId: Id
  topicId?: Id | null
  userName?: string | null
  action: 'typing' | 'cancel'
}
```

---

## 5. Frontend: API Interface (`web/src/api.ts`)

### 5a. Widen `TelegramApi` callback

```ts
subscribeUpdates(
  onUpdate: (update: TelegramUpdate | TelegramTypingUpdate) => void,
  onError?: (error: Event | Error) => void
): () => void
```

### 5b. Parse `event: typing` in SSE loop

In `HttpTelegramApi.streamUpdates()`, after the existing `message` event handler, add:

```ts
if (eventType === 'typing') {
  const payload = await decryptStreamPayload(dataStr)
  const update: TelegramTypingUpdate = { ...JSON.parse(payload), type: 'typing' }
  onUpdate(update)
  return
}
```

Also import `TelegramTypingUpdate` from `./types`.

---

## 6. Frontend: Instrumented API (`web/src/instrumentedApi.ts`)

No structural change. The `subscribeUpdates` wrapper passes through to `this.inner.subscribeUpdates(onUpdate, onError)` with the widened callback type. No latency logging needed for high-frequency typing events.

---

## 7. Frontend: Fixture API (`web/src/fixtureApi.ts`)

### 7a. Import `TelegramTypingUpdate`

### 7b. Add injection method

```ts
injectTyping(chatId: Id, topicId: Id | null, userName: string) {
  const update: TelegramTypingUpdate = {
    type: 'typing',
    chatId,
    topicId,
    userName,
    action: 'typing',
  }
  for (const sub of this.subscribers) sub(update)
}

cancelTyping(chatId: Id, topicId: Id | null) {
  const update: TelegramTypingUpdate = {
    type: 'typing',
    chatId,
    topicId,
    userName: null,
    action: 'cancel',
  }
  for (const sub of this.subscribers) sub(update)
}
```

### 7c. Widen `subscribers` type

```ts
private subscribers = new Set<(update: TelegramUpdate | TelegramTypingUpdate) => void>()
```

### 7d. `subscribeUpdates` type matches

Update signature to accept the widened type.

---

## 8. Frontend: Controller State (`web/src/controller/appController.ts`)

### 8a. Add `typing` field to message-view states

Every `{ screen: 'sidebar'; focus: 'messages' }` variant and `sidebarRecording`, `sidebarSent` gets:

```ts
typing?: { userName: string; expiresAt: number } | null
```

(Only the base `sidebar` + `focus: 'messages'` union needs it; the others are transient and don't render typing.)

### 8b. Add typing expiry timer

New field on `TelegramAppController`:

```ts
private typingTimer: ReturnType<typeof setTimeout> | undefined
```

### 8c. Handle typing updates

```ts
handleTelegramTypingUpdate(update: TelegramTypingUpdate) {
  const state = this.state
  if (state.screen !== 'sidebar' || state.focus !== 'messages') return
  if (!updateMatchesThread(update, state)) return
  
  if (this.isInputQuiet()) {
    this.deferTypingUpdate(update)
    return
  }
  
  if (update.action === 'typing' && update.userName) {
    this.state = {
      ...state,
      typing: { userName: update.userName, expiresAt: Date.now() + 5000 },
    }
    this.startTypingTimer()
    this.flushRender()
  } else if (update.action === 'cancel') {
    this.state = { ...state, typing: null }
    this.cancelTypingTimer()
    this.flushRender()
  }
}

private deferTypingUpdate(update: TelegramTypingUpdate) {
  this.deferredTyping = update
}

private async flushDeferredTyping() {
  const deferred = this.deferredTyping
  this.deferredTyping = undefined
  if (deferred) await this.handleTelegramTypingUpdate(deferred)
}

private startTypingTimer() {
  this.cancelTypingTimer()
  const state = this.state
  if (state.screen !== 'sidebar' || state.focus !== 'messages' || !state.typing) return
  const delay = Math.max(0, state.typing.expiresAt - Date.now())
  this.typingTimer = setTimeout(() => {
    if (this.state.screen === 'sidebar' && this.state.focus === 'messages' && this.state.typing) {
      const s = this.state
      this.state = { ...s, typing: null }
      this.flushRender()
    }
  }, delay)
}

private cancelTypingTimer() {
  if (this.typingTimer !== undefined) {
    clearTimeout(this.typingTimer)
    this.typingTimer = undefined
  }
}
```

### 8d. Wire from `handleTelegramUpdate` path

In `AppContext.tsx` where the `subscribeUpdates` callback lives, or in a new entrypoint — actually, typing updates arrive through the same `subscribeUpdates` callback. So the controller needs to discriminate in its handler.

Add in `handleTelegramUpdate` (rename to `handleUpdate` or dispatch inside `subscribeUpdates`):

Actually, the current flow is:
1. `AppContext.tsx` calls `api.subscribeUpdates((update) => controller.handleTelegramUpdate(update))`
2. `handleTelegramUpdate` only handles `type: 'message'`

Simplest: widen `handleTelegramUpdate` to also handle `TelegramTypingUpdate`:

```ts
async handleTelegramUpdate(update: TelegramUpdate | TelegramTypingUpdate) {
  if (update.type === 'typing') {
    await this.handleTelegramTypingUpdate(update)
    return
  }
  // existing message handling ...
}
```

Also add `TelegramTypingUpdate` import.

### 8e. Clear typing on navigation

When the user leaves the message screen (back to chats/topics, goes to recording, etc.), clear typing state and timer. This is handled naturally since `setState` replaces the entire state object and the new state won't carry `typing`.

But we must also cancel the timer on any state transition away from messages:

In `setState()`, add:
```ts
if (next.screen !== 'sidebar' || next.focus !== 'messages') {
  this.cancelTypingTimer()
  this.deferredTyping = undefined
}
```

### 8f. Deferred typing flush

Add `this.deferredTyping` to the input-quiet exit path alongside the existing deferred update/message refresh flushes. In the method that runs after `INPUT_QUIET_MS` passes:

```ts
await this.flushDeferredTyping()
```

---

## 9. Frontend: Screen Model (`web/src/controller/model.ts`)

### 9a. Import locale

Already imported via `getLocale()`.

### 9b. Modify footer for messages with typing

In `screenModel()`, when building the sidebar/messages variant:

```ts
// In the sidebar messages branch:
const typing = state.typing
const footer = typing
  ? sanitizeGlassesText(`${typing.userName} ${locale.typingSuffix}`)
  : footerText(state.status, locale.footerSwipeScroll)
```

Where `locale.typingSuffix` is e.g. `"typing…"` (or `"is typing…"` depending on how we structure the locale string).

Design choice: locale string is `typingSuffix: "typing…"` → footer becomes `"Abhinav typing…"`. Footer must remain ≤ 120 bytes. Names can be long, so we should truncate the name if the combined string exceeds the byte limit:

```ts
function typingFooter(userName: string, locale: LocaleStrings): string {
  const raw = `${userName} ${locale.typingSuffix}`
  if (utf8ByteLength(raw) <= 120) return sanitizeGlassesText(raw)
  // Truncate the name
  const suffix = ` ${locale.typingSuffix}`
  const maxNameBytes = 120 - utf8ByteLength(suffix)
  return sanitizeGlassesText(trimUtf8Bytes(userName, maxNameBytes) + suffix)
}
```

---

## 10. Frontend: Locales

### 10a. English base (`web/src/locales/en.ts`)

Add:
```ts
typingSuffix: 'typing\u2026',  // "typing…"
```

### 10b. All other locale files

Add `typingSuffix` to every locale file. For files with full translations (es, fr, de, it, pt, nl, ja, ko, zh, ms), provide the translated string. For minimal files that only have 1-3 keys (sv, pl, tr, cs, ro, hu, vi, fi, no, da, id, ca, sk), add the English string as a fallback.

---

## 11. Backend Tests (`tests/backend/`)

### 11a. `test_telegram_normalization.py`

Add test for `normalize_chat_action`:
- `SendMessageTypingAction` → `TypingUpdate(action='typing')`
- `SendMessageCancelAction` → `TypingUpdate(action='cancel')`
- Other actions (record audio, upload photo) → `None`
- Forum topic chat_id + topic_id extraction

### 11b. `test_api.py`

Mock `TelegramService.update_events()` to yield a `TypingUpdate` and verify the SSE stream emits `event: typing` with the correct payload.

---

## 12. Frontend Unit Tests

### 12a. `web/test/controller.test.ts`

- Typing update sets `typing` state in message view
- Typing cancel clears `typing` state
- Typing update on wrong screen/chat is ignored
- Auto-clear after 5s timeout
- Navigation away from messages clears typing
- Input-quiet defers typing, flushed on quiet end

### 12b. `web/test/model.test.ts`

- Footer shows `"X typing…"` when `typing` is set
- Footer shows normal controls when `typing` is null
- Long name truncated to fit 120-byte footer

---

## 13. Harness Changes (Detailed)

### 13.1 Test mode event types (`web/src/testMode.ts`)

No new event types needed. The existing `logTeleGlanceTest('state', …)` and `logTeleGlanceTest('render', …)` events already carry the controller state and screen model. When `typing` is added to the `sidebar` `focus: 'messages'` state, `summarizeAppState()` must be updated to include it:

```ts
// In summarizeAppState, sidebar focus:'messages' branch:
return {
  // ... existing fields ...
  typing: state.typing ?? null,
}
```

The `summarizeScreenModel` for `sidebar` already emits `panelFooter`, so the harness can assert on the footer text directly. No new field needed there.

### 13.2 Fixture command plumbing (`web/vite.config.ts`)

Add two new `FixtureCommand` variants so the harness can inject typing events:

```ts
type FixtureCommand =
  | /* ... existing ... */
  | { kind: 'injectTyping'; chatId: string; topicId?: string | null; userName: string }
  | { kind: 'cancelTyping'; chatId: string; topicId?: string | null }
```

No changes needed to the server middleware — `POST /api/test/fixture` already accepts arbitrary commands and queues them for the in-page poller.

### 13.3 Fixture API command handler (`web/src/fixtureApi.ts`)

In `startCommandPolling`, add cases for `injectTyping` and `cancelTyping`:

```ts
case 'injectTyping': {
  api.injectTyping(cmd.chatId, cmd.topicId ?? null, cmd.userName)
  break
}
case 'cancelTyping': {
  api.cancelTyping(cmd.chatId, cmd.topicId ?? null)
  break
}
```

These dispatch `TelegramTypingUpdate` events through the same `subscribers` set used by `setInjectedNotification`.

### 13.4 Simulator flow harness (`scripts/simulator-flow.mjs`)

#### 13.4a New input types in `executeStep()`

After the `testTopicNotify` block, add typing injection inputs:

```js
if (step.input === 'testTypingAlpha') {
  await sendTestCommand({ kind: 'injectTyping', chatId: 'fixture-chat-0', userName: 'Alice' })
}
if (step.input === 'testTypingForum') {
  await sendTestCommand({ kind: 'injectTyping', chatId: 'fixture-chat-1', topicId: 101, userName: 'Bob' })
}
if (step.input === 'testCancelTyping') {
  // Must come after a testTyping* step that opened messages
  await sendTestCommand({ kind: 'cancelTyping', chatId: 'fixture-chat-0' })
}
```

`injectTyping` is a fixture command (no click/swipe input). The step has `"input": "testTypingAlpha"` and no `targetAction`. The harness queues the command via `sendTestCommand`, then the step's `waitForTestEvent` waits for the state/event assertions.

#### 13.4b `sendTestCommand` compatibility

No changes needed — `sendTestCommand` POSTs to `/api/test/fixture` with the full command object. The Vite fixture bridge queues it, the in-page poller picks it up, and `startCommandPolling` dispatches to the fixture API.

#### 13.4c Real-mode behavior

Typing events in real mode arrive through the SSE stream, not fixture injection. The harness already tracks `currentScreen` and `currentFocus` from state events. No special real-mode handling needed — the state event will carry `typing` and the render event will carry the modified `panelFooter`.

#### 13.4d Per-step event budget

Typing injection steps are fixture-command steps (no user interaction). Set `budgetMs: 500` since they only need the controller to process the injected event and emit a render.

### 13.5 Fuzzy test harness (`scripts/fuzzy-test.mjs`)

No structural changes needed:

- `isValidState()` for `sidebar.focus === 'messages'` does not constrain optional fields — `typing` can appear without breaking the validator.
- `checkStructuralInvariants()` already enforces `panelFooter` ≤ 120 bytes — typing footers are automatically bounded.
- `VALID_TRANSITIONS` covers all screen types, and typing is a state field update within `sidebar`, not a screen transition.

**Unchanged by typing indicators.** The fuzzy test will naturally exercise the typing path if it happens to open messages and a typing event fires (in fixture mode, the fixture doesn't auto-inject typing events, so this path is tested only by the simulator-flow catalog).

### 13.6 UI Invariants catalog (`docs/UI_INVARIANTS.json`)

Add steps to the `steps` array:

```json
{
  "name": "typing-indicator-footer",
  "target": "sidebar.messages.typing",
  "input": "testTypingAlpha",
  "budgetMs": 500,
  "expect": {
    "state": { "screen": "sidebar", "focus": "messages", "typing": true },
    "renderBodyContains": ["Alice", "typing…"],
    "renderBodyNotContains": ["Swipe scroll", "Click record", "Double click back"]
  }
},
{
  "name": "typing-indicator-cancel",
  "target": "sidebar.messages.normal",
  "input": "testCancelTyping",
  "budgetMs": 500,
  "expect": {
    "state": { "screen": "sidebar", "focus": "messages", "typing": null },
    "renderBodyContains": ["Swipe scroll", "Click record", "Double click back"]
  }
}
```

The `renderBodyContains` matcher searches the JSON-serialised render model, so `"Alice"` and `"typing…"` in the `panelFooter` field are matched. `renderBodyNotContains` ensures the normal controls are absent during typing, then present after cancel.

### 13.7 UI Invariants document (`docs/UI_INVARIANTS.md`)

Add screen definition after `sidebar.messages.normal`:

```
### 4.8b `sidebar.messages.typing` (typing indicator active)
- **state**: same as `sidebar.messages.normal` plus `typing: { userName: 'Alice', expiresAt: <future> }`
- **render**: `{ kind: 'sidebar', focus: 'panel', fullWidth: true }`
- **content**:
  - `panelBody`: same as `sidebar.messages.normal`
  - `panelFooter`: `'<userName> typing…'` (e.g. `'Alice typing…'`), ≤ 120 bytes
  - `panelFooter.notContains`: normal controls (`'Swipe scroll'`, `'Click record'`, `'Double click back'`)
- **transitions**:
  - auto -> `sidebar.messages.normal` after 5s timeout or on `cancel` update
  - `press` -> `sidebarRecording` (still works; typing cleared on transition)
  - `doublePress` -> `back`
- **budget**: 500 ms to render
```

### 13.8 Locale test (`web/test/locales.test.ts`)

No structural changes needed. The test validates that every key in `en.ts` exists in every locale file. Adding `typingSuffix` to `en.ts` automatically covers all locales via the `...en` spread.

### 13.9 Container contract

No container ID changes. The typing indicator uses `panelFooter` (container ID 4) which already exists and stays ≤ 120 bytes. No new containers are added. The container ID contract in `UI_INVARIANTS.md` §1.5 is unchanged.

### 13.10 Golden screenshot validation

Add a golden screenshot step for the typing indicator state so the harness validates visual appearance. Use `update-goldens` to capture it, same as other steps. The golden captures the footer rendering `"Alice typing…"` in the bottom bar.

### 13.11 Summary of harness files changed

| File | Change |
|------|--------|
| `web/src/testMode.ts` | Add `typing` to `summarizeAppState` messages branch |
| `web/vite.config.ts` | Add `injectTyping`, `cancelTyping` to `FixtureCommand` |
| `web/src/fixtureApi.ts` | Handle `injectTyping`/`cancelTyping` in command poller |
| `scripts/simulator-flow.mjs` | `testTypingAlpha`, `testTypingForum`, `testCancelTyping` inputs |
| `docs/UI_INVARIANTS.json` | Typing indicator + cancel steps |
| `docs/UI_INVARIANTS.md` | `sidebar.messages.typing` screen definition |
| `web/test/simulator-goldens/` | New golden screenshot (auto-captured) |

No changes to: `scripts/fuzzy-test.mjs`, `web/test/ui-invariants.test.ts`, `web/test/locales.test.ts`, `web/test/evenBridge.test.ts`.

---

## 14. Edge Cases & Risks

| Scenario | Handling |
|----------|----------|
| Multiple users typing in same chat | Last update wins; only one name shown. This matches Telegram desktop behavior. |
| Typing in forum topic while viewing different topic | `updateMatchesThread` filters by topicId; only shows if viewing the same topic. |
| Backend SSE reconnect during typing | SSE reconnects cleanly; no state recovery needed for typing (transient). |
| User starts recording while typing indicator shows | Recording state doesn't carry `typing` field → indicator disappears naturally. |
| Very long user name | Truncated in footer to fit 120-byte limit (model.ts). |
| ChatAction events for non-typing actions (record voice, upload file) | Filtered in `normalize_chat_action`. Only `SendMessageTypingAction` and `SendMessageCancelAction` generate updates. |
| Real G2 hardware — unexpected event shapes | ChatAction handler uses `getattr` defensively; falls through to `None` silently for unrecognized shapes. |
| Typing starts, user exits messages, typing cancel arrives later | Deferred typing state is cleared on state transition away from messages. |
| High-frequency typing events (user types a message for 30 seconds, receiving multiple ChatAction updates) | Each `typing` event resets the 5s timer — the indicator stays until 5s after the last typing event. |

---

## Files Touched (Complete List)

### Backend (3 files)
1. `server/app/models.py` — new `TypingUpdate` DTO
2. `server/app/services/telegram.py` — handler, normalization, queue type, protocol update
3. `server/app/main.py` — SSE stream discriminator

### Frontend core (7 files)
4. `web/src/types.ts` — `TelegramTypingUpdate` type
5. `web/src/api.ts` — SSE parsing, widened callback
6. `web/src/instrumentedApi.ts` — pass-through (type widening only)
7. `web/src/fixtureApi.ts` — inject/cancel typing methods, command poller cases
8. `web/src/controller/appController.ts` — typing state, handler, timer, deferral
9. `web/src/controller/model.ts` — typing footer rendering
10. `web/src/contexts/AppContext.tsx` — widened callback type (minor)

### Locales (2 conceptual, 26 files)
11. `web/src/locales/en.ts` — `typingSuffix` string
12. `web/src/locales/*.ts` (all 25) — `typingSuffix` key (inherit from en via `...en`)

### Harness (5 files)
13. `web/src/testMode.ts` — add `typing` to `summarizeAppState` messages branch
14. `web/vite.config.ts` — add `injectTyping`, `cancelTyping` to `FixtureCommand` type
15. `scripts/simulator-flow.mjs` — `testTypingAlpha`, `testTypingForum`, `testCancelTyping` inputs
16. `docs/UI_INVARIANTS.json` — typing indicator + cancel steps
17. `docs/UI_INVARIANTS.md` — `sidebar.messages.typing` screen definition

### Golden screenshots (1 directory)
18. `web/test/simulator-goldens/` — new typing indicator golden (auto-captured)

### Tests (4 files)
19. `tests/backend/test_telegram_normalization.py` — normalization tests
20. `tests/backend/test_api.py` — SSE typing event tests
21. `web/test/controller.test.ts` — typing state + timer tests
22. `web/test/model.test.ts` — typing footer rendering tests
