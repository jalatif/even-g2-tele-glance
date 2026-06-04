# TeleGlance UI Invariants

This document is the source of truth for every screen the glasses can show. The simulator harness (`scripts/simulator-flow.mjs`) consumes `docs/UI_INVARIANTS.json`, which is generated from the same definitions that appear in this file.

## 1. Layout contract

The glasses display is `576 x 288` pixels. The Even Hub SDK imposes these hard limits, which the harness enforces on every render event.

| Region         | Container                                       | Byte limit | Visible rows       | Other                                          |
| -------------- | ----------------------------------------------- | ---------- | ------------------ | ---------------------------------------------- |
| `title`        | `TextContainerProperty`                         | 120        | 1-2                | full width                                     |
| `outer`        | `TextContainerProperty`                         | 0          | n/a                | 2 px border, color 8                           |
| `sidebar`      | `ListContainerProperty` (focus=sidebar) or `TextContainerProperty` (focus=panel) | 999  | 206 px tall        | left x=2, y=38, width=168                      |
| `separator`    | `TextContainerProperty`                         | 0          | n/a                | x=168, width=2, height=206                     |
| `panelBody`    | `TextContainerProperty`                         | 999        | up to 12 compact rows | right x=170, y=38, width=404                |
| `panelBox`     | `TextContainerProperty`                         | 999        | up to 8 rows       | x=184, y=54, width=376, 1 px border            |
| `panelFooter`  | `TextContainerProperty`                         | 120        | 1-2                | x=2, y=248, width=572                          |
| `eventOverlay` | `TextContainerProperty`                         | 0          | n/a                | full size, capture 1 when focus=panel          |
| native list    | `ListContainerProperty`                         | n/a        | 1-20 items         | x=2, y=38, width=166, height=206, `isItemSelectBorderEn=1` |

Harness invariants on every render:
- `model.title` UTF-8 bytes <= 120
- `model.panelBody` UTF-8 bytes <= 999
- `model.panelFooter` UTF-8 bytes <= 120
- `model.sidebarItems` length 1..20, each item byte length <= 64
- For `kind === 'sidebar'`, the bridge always renders container IDs `0..7` (the harness parses the bridge JSON for these IDs and asserts no stale container survives a state change)

## 1.5 Container ID contract

Container IDs are shared across `TextContainerProperty`, `ListContainerProperty`, and `ImageContainerProperty` objects passed to the Even Hub SDK. The firmware treats container ID as a unique key; duplicate IDs cause one container to be silently dropped.

| ID  | Container        | Type | Notes                                               |
| --- | ---------------- | ---- | --------------------------------------------------- |
| 0   | `outer`          | Text | 2 px border, full size                              |
| 1   | `title`          | Text | Top bar, 36 px height                               |
| 2   | `event-overlay`  | Text | Full-size transparent tap target                    |
| 3   | `separator`      | Text | 2 px vertical line between sidebar + panel          |
| 4   | `footer`         | Text | Bottom bar, 38 px height                            |
| 5   | `sidebar`        | Text | Sidebar text content (panel-focus only)             |
| 6   | `panelBody`      | Text | Right-side message/preview text                     |
| 7   | `panelBox`       | Text | Bordered message box (optional)                     |
| 8   | `sidebar-list`   | List | Native list for chat/topic selection (sidebar-focus) |

**Invariant**: Container IDs MUST be unique across ALL containers sent in a single `rebuildPageContainer` or `createStartUpPageContainer` call. A list container and a text container with the same ID is a bug. Every render event's bridge payload MUST be validated by the harness for:
- All container IDs are unique across `textObject`, `listObject`, and `imageObject`
- When `focus === 'sidebar'`, `listObject[0].containerID === 8` and `textObject` does NOT contain ID 5 (sidebar text)
- When `focus === 'panel'`, `listObject[0]` is hidden (1x1, no capture) and `textObject` contains ID 5 with sidebar content
- `containerTotalNum` equals `textObject.length + listObject.length + imageObject.length`

**Native list invariants** (when `focus === 'sidebar'`):
- `listObject[0].containerID === 8`
- `listObject[0].isEventCapture === 1`
- `listObject[0].itemContainer.itemCount` equals `model.sidebarItems.length`
- `listObject[0].itemContainer.itemName` matches `model.sidebarItems`
- `listObject[0].itemContainer.isItemSelectBorderEn === 1`
- `listObject[0].itemContainer.itemWidth === 0` (auto-fill)
- No `TextContainerProperty` has `containerID === 8`

## 2. Matcher rules

`contains` arrays are matched against the screen model with:
- Case-insensitive substring match
- Whitespace normalised to single space
- For `panelBox.heading.contains` and `panelBox.content.contains`, the matcher applies the same `formatBoxContent` pipeline the bridge uses, so it tolerates the same `+`, `-`, `|` decorations the bridge removes
- For `panelBody.contains` on text-kind screens, the matcher ignores trailing ellipsis added by `trimForContainer`
- `renderBodyContains` matches against the latest render model emitted by the bridge (`[TeleGlanceTest] {"event":"render",...}` payload). Each needle is a substring of the JSON-serialised model.
- `renderBodyNotContains` is the inverse: each needle MUST NOT appear anywhere in the render model. Use it to catch stale data: a previous chat/topic name leaking through after a swipe, "Older fixture" surviving a back navigation, "Sent" status persisting into a new recording, the wrong preview body on a cached-only topic.
- `noLifecycles: ["asleep", "wake"]` fails the step if any matching `lifecycle` event fires during the step's input window. The G2 simulator (and the real G2 hardware on screen-timeout) fires system `doublePress` events that send the controller to `asleep` and back. The user perceives this as "scroll doesn't work" or "I select something and something else opens up". Use `noLifecycles: ["asleep", "wake"]` on a single-input step with a budget >= 4s to assert the controller stays in the active screen during a known-good interaction.
- `noContainerFailures: true` fails the step if the simulator rejected any `textContainerUpgrade` call during the step (matched by the `[simulator] [WARN ...] TextContainerUpgrade failed: container N not found` log line). The G2 simulator emits this warning when the WebView asks to update a container ID the current page layout does not own. Each rejected call means the panel body, panel box, or sidebar text did not update visually on the glasses — the exact class of bug ("ghost text", "stale right side") that passes the state-only harness checks but is visible to the user on the display.

`notContains` catches stale data: stale chat name on the right panel after a swipe, "Older fixture page" appearing twice, "Sent" status surviving into the next recording flow.

## 3. Performance budgets

| Budget                | Value (ms) | What it covers                                                                          |
| --------------------- | ---------: | --------------------------------------------------------------------------------------- |
| `maxTransitionMs`     | 1000       | Every state-to-state step. Includes input posting, controller dispatch, render, capture |
| `maxApiCallMs`        | 300        | Single `api.*` call. Multiple calls in one step sum independently                       |
| `maxMessageLoadMs`    | 1000       | `press` -> `state.screen === 'sidebar'` & `focus === 'messages'` & messages non-empty   |
| `maxChatLoadMs`       | 1000       | `init` -> `state.screen === 'sidebar'` & `focus === 'chats'`                            |
| `maxSendRoundtripMs`  | 2000       | `press` on `sidebarConfirm` (Send) -> `state.status === 'Sent'` and outgoing message    |
| `maxSwipeSelectionMs` | 50         | `swipeUp`/`swipeDown` on chat/topic list -> `selectedIndex` update (no render)         |
| `maxInitialRenderMs`  | 800        | First `render` event after `init()` completes                                          |
| `maxLoadingStateMs`   | 500        | `press` on chat/topic -> render with loading status must appear before blocking I/O    |
| `maxRightPanelUpdateMs`| 1000      | Topic preview / background message refresh -> right-panel update without left flicker  |
| `longRunningStates`   | --         | `sidebarTranscribing`, `sidebarSending`                                                 |

Per-step latencies are split into `stateMs` (input -> matching state event), `apiMs` (sum of `api` event durations), `renderMs` (render event -> screenshot), `totalMs` (wall clock).

## 3.5 UI responsiveness (non-blocking invariants)

- Opening a chat or topic MUST render a loading state (right panel only) within `maxLoadingStateMs` before any network I/O blocks the controller
- Chat/topic list swipes MUST update `selectedIndex` within `maxSwipeSelectionMs` without triggering a render event
- Topic preview fetching MUST NOT block list scroll input; the left native list remains responsive during right-panel loading
- Startup prefetching MUST NOT delay the first visible chat list render past `maxInitialRenderMs`
- Background refreshes (polling, SSE updates) MUST NOT cause the native list selection to snap back to row 0
- Async results from stale requests (previous chat open that was abandoned by backing out) MUST be discarded silently
- Chat/topic list scroll MUST dispatch a sidebar panel partial render through `bridge.enqueueSidebarPanel` (NOT a full `bridge.render` or awaited `bridge.renderSidebarPanel`). The native list (container 8) MUST stay untouched so the firmware highlight cannot snap back to row 0. Rapid swipes MUST coalesce: only the most recent panel model ever reaches the glasses
- The bridge exposes `render.partial.enqueue` and `render.partial.flush` events for the harness to verify coalescing. `getPartialRenderStats().dropped > 0` is expected during a swipe streak

### 4.1 `loading`
- **state**: `{ screen: 'loading', message: 'Starting...' or 'Checking Telegram session...' }`
- **render**: `{ kind: 'text', title: 'Telegram' }`
- **body.contains**: `['Checking Telegram session']` (default) OR `['Starting']` (briefly during boot)
- **transitions**: `press` -> stays (no-op). `foreground` -> re-runs `init()`
- **budget**: 500 ms
- **apiCalls**: `authStatus`
- **eventMustEmit**: `lifecycle.kind === 'start'`

### 4.2 `auth.needsSetup`
- **state**: `{ screen: 'auth', mode: 'needsSetup', message: 'Follow the in ... on the phone.' }`
- **render**: `{ kind: 'text', title: 'Telegram' }`
- **body.contains**: `['instructions', 'Settings']`
- **transitions**: `press` -> stays; message re-rendered
- **budget**: 500 ms
- **apiCalls**: `authStatus` returns `{ configured: false, authorized: false }`

### 4.3 `auth.signedOut`
- **state**: `{ screen: 'auth', mode: 'signedOut', message: '... phone number ...' }`
- **render**: `{ kind: 'text', title: 'Telegram' }`
- **body.contains**: `['phone number']`
- **transitions**: `press` -> stays
- **budget**: 500 ms
- **apiCalls**: `authStatus` returns `{ configured: true, authorized: false }`

### 4.4 `auth.phonePending`
- **state**: `{ screen: 'auth', mode: 'phonePending', message: '... code ...', phone: '+1...' }`
- **render**: `{ kind: 'text', title: 'Telegram Login' }`
- **body.contains**: `['code']`
- **transitions**: `press` -> stays
- **budget**: 500 ms
- **apiCalls**: `startPhoneAuth` then `verifyPhoneAuth`

### 4.5 `sidebar.chats` (root chat list, focus on left list)
- **state**: `{ screen: 'sidebar', focus: 'chats', chats: [...5 chats...], selectedChatIndex: 0..4 }`
- **render**: `{ kind: 'sidebar', title: 'Telegram', focus: 'sidebar' }`
- **left**:
  - `sidebarTitle`: `'Chats'`
  - `sidebarItems.exact`: `['Fixture Alpha', 'Fixture Forum (3)', 'Fixture Ops', 'Fixture Research', 'Fixture Archive']`
  - `sidebarItems.markerAt`: equals `state.selectedChatIndex`
  - The native list `ListContainerProperty` must include `isItemSelectBorderEn: 1`
  - `panelTitle`: `state.chats[selectedChatIndex].title` truncated to 20 chars
  - `panelBody.contains`: `state.chats[selectedChatIndex].lastMessage` (fallback) OR the cached messages of `state.chats[selectedChatIndex]` (e.g. `fixture-ops-body` for `fixture-chat-2`). The startup prefetch MUST populate the right panel for the first five chats so the initial render never shows the `lastMessage` fallback alone.
  - `panelBody.notContains`: stale messages from any non-selected chat, AND the `lastMessage` of any other chat while the selected chat has cached messages. This is the regression that hid D2 — the right panel was stuck on the first chat's messages while the user scrolled.
  - `panelFooter`: `'Swipe chats | Press open'`
  - `panelBox`: `null`
- **transitions**:
  - `swipeUp` / `swipeDown` -> `state.selectedChatIndex` moves (clamped)
  - `press` on normal chat -> `sidebar.messages.normal`
  - `press` on forum chat -> `sidebar.topics.noPreview`
  - `selectIndex(n)` with `n === state.selectedChatIndex` after arming window -> `press`
  - `doublePress` -> `asleep`; bridge must call `turnScreenOff` before state event
- **budget**: 500 ms per swipe, 1000 ms after `init`
- **apiCalls**: `listChats`

### 4.6 `sidebar.topics.noPreview` (forum topics, preview not yet loaded)
- **state**: `{ screen: 'sidebar', focus: 'topics', chat, topics: [...4...], selectedTopicIndex: 0 }`
- **render**: `{ kind: 'sidebar', focus: 'sidebar' }`
- **left**:
  - `sidebarTitle`: `'Topics'`
  - `sidebarItems.exact`: `['Fixture Topic Zero', 'Fixture Topic One (1)', 'Fixture Topic Two (1)', 'Fixture Topic Three (1)']`
  - `sidebarItems.markerAt`: equals `state.selectedTopicIndex`
- **right**:
  - `panelTitle`: selected topic title truncated to 20
  - `panelBody.contains`: `['Loading messages...']`
  - `panelBody.notContains`: any topic `lastMessage` strings
  - `panelFooter`: `'Loading messages...'`
  - `panelBox`: `null`
- **transitions**:
  - `swipeUp` / `swipeDown` -> `selectedTopicIndex` moves
  - `press` -> `sidebar.messages.topic`
  - `doublePress` -> `sidebar.chats` with `selectedChatIndex` preserved
- **budget**: 1000 ms to load first preview
- **apiCalls**: `listTopics` once; `listMessages` for each unique selected topic preview

### 4.7 `sidebar.topics.preview` (forum topics, preview loaded)
- **state**: same as `noPreview` plus `previewMessages`, `previewTopic`, `previewCursor`, `previewIsNewestPage: true`
- **render**: `{ kind: 'sidebar', focus: 'sidebar' }`
- **right**:
  - `panelBody.contains`: first message text of selected topic preview
  - `panelBody.contains`: second message text when present
  - `panelBody.notContains`: stale messages from any other topic (e.g. `fixture-topic-one-body` must not survive a swipe to topic 2). The right panel MUST reflect the currently selected topic after every swipe, using the prefetched cache when available and falling back to a single `api.listMessages` call when it is not.
  - `panelFooter`: `'Swipe topics | Press open'`
  - `panelBox`: optional; when present, `panelBody` must be empty
- **transitions**: same as `noPreview`
- **budget**: 1000 ms
- **apiCalls**: as `noPreview` plus the preview fetch
- **eventMustEmit**: `api.call === 'listMessages'` with `args.topicId === <selected topic id>`

### 4.8 `sidebar.messages.normal` (normal chat messages, no loading)
- **state**: `{ screen: 'sidebar', focus: 'messages', chat, messages: [...], cursor, isNewestPage: true, scrollOffset: 0, back }`
- **render**: `{ kind: 'sidebar', focus: 'panel' }`
- **left**:
  - `sidebarTitle`: `'Chats'`
  - `sidebarItems`: chat list, marker at `state.selectedChatIndex`
  - `sidebarItems.markerAt`: equals `state.selectedChatIndex`
- **right**:
  - `panelBody.contains`: each visible message's `text`. For `fixture-chat-0`: `'Alpha message page contains fixture-alpha-body for startup testing.'` and `'Alpha outgoing marker for visual validation.'`
  - `panelBody.byteLength`: <= 999
  - `panelFooter`: `'Click record | Double click back'`
  - `panelBox`: optional for long messages
- **transitions**:
  - `press` -> `sidebarRecording`
  - `doublePress` -> `back` (which is `sidebar.chats` for normal chats)
  - `swipeUp` -> `loadOlderMessages`; intermediate `state.status === 'Loading older messages...'`
  - `swipeDown` on newest page -> no-op
  - `swipeDown` on older page -> returns toward newest
- **budget**: 1000 ms first page; 1000 ms per older page
- **apiCalls**: `listMessages` on open, `markRead` after first frame

### 4.9 `sidebar.messages.topic` (forum topic messages, no loading)
- **state**: same as `sidebar.messages.normal` with `topic`, `topics`, `selectedTopicIndex` populated
- **render**: `{ kind: 'sidebar', focus: 'panel' }`
- **left**:
  - `sidebarTitle`: `'Topics'`
  - `sidebarItems`: topic list, marker at `state.selectedTopicIndex`
- **right**: same rules as `sidebar.messages.normal`
- **transitions**:
  - `doublePress` -> `back` (which is `sidebar.topics` for forum topics), NOT chats
- **budget**: 1000 ms
- **apiCalls**: `listMessages(chat.id, { topicId, limit: 50 })` using **forum topic id**, not `topMessageId`

### 4.10 `sidebar.messages.loading` (intermediate state)
- **state**: same as `sidebar.messages.normal` or `topic` but `state.status === 'Loading ...'` and `state.messages === []`
- **render**: `{ kind: 'sidebar', focus: 'panel' }`
- **right**:
  - `panelBody.contains`: `['Loading ']`
  - `panelFooter.contains`: `['Loading ']`
  - `panelBox`: `null`
- **transitions**: automatic -> `sidebar.messages.normal` or `sidebar.topics`
- **budget**: 1000 ms
- **eventMustEmit**: `api.startedAt` precedes the state render, the render with data follows `api.endedAt`

### 4.11 `sidebarRecording` (recording in progress)
- **state**: `{ screen: 'sidebarRecording', focus: 'messages', chat, topic?, messages, back, chunks: [...Uint8Array], startedAt }`
- **render**: `{ kind: 'sidebar', title: 'Recording reply', focus: 'panel' }`
- **left**:
  - `sidebarTitle`: `'Chats'` or `'Topics'`
  - `sidebarItems`: same list as active thread
- **right**:
  - `panelTitle`: `'Recording'`
  - `panelBody`: empty or last visible message
  - `panelFooter`: `'Click stop | Double click cancel'`
- **transitions**:
  - `press` -> `sidebarTranscribing`; `setAudioEnabled(true)` then `setAudioEnabled(false)` observed
  - `doublePress` -> back to `sidebar.messages` without sending
  - `audioChunk` events accumulate into `state.chunks`
- **budget**: 2000 ms total recording + transcribe + confirm
- **eventMustEmit**: `recording.kind` sequence: `start`, `audioChunk` x N, `stop`, `transcribe.start`, `transcribe.end`

### 4.12 `sidebarTranscribing`
- **state**: `{ screen: 'sidebarTranscribing', focus: 'messages', chat, topic?, messages, back }`
- **render**: `{ kind: 'sidebar', title: 'Transcribing', focus: 'panel' }`
- **left**: empty (`sidebarItems: []`, `sidebarTitle: ''`)
- **right**:
  - `panelTitle`: `'Converting voice...'`
  - `panelBody`: empty
  - `panelFooter`: empty
- **transitions**: automatic -> `sidebarConfirm` once `api.transcribe` returns
- **budget**: 1000 ms
- **apiCalls**: `transcribe(wav)`
- **eventMustEmit**: `recording.kind === 'transcribe.end'`

### 4.13 `sidebarConfirm.send` (Send highlighted)
- **state**: `{ screen: 'sidebarConfirm', focus: 'messages', chat, topic?, messages, transcript, selectedIndex: 0, back }`
- **render**: `{ kind: 'sidebar', title: 'Reply: <transcript truncated 30>', focus: 'panel' }`
- **right**:
  - `panelBody.contains`: `['> Send']`
  - `panelBody.contains`: `['  Cancel']`
  - `panelBody.notContains`: `['> Cancel']`
  - `panelFooter`: `'Swipe select | Press confirm'`
- **transitions**:
  - `press` -> `sidebarSending` -> `sidebar.messages` with `state.status === 'Sent'`
  - `swipeUp` / `swipeDown` -> `sidebarConfirm.cancel`
  - `doublePress` -> back to `sidebar.messages` without sending
- **budget**: 2000 ms full roundtrip
- **apiCalls**: `sendMessage(chat.id, { text, topicId? })`

### 4.14 `sidebarConfirm.cancel` (Cancel highlighted)
- **state**: same as `sidebarConfirm.send` but `selectedIndex: 1`
- **right**:
  - `panelBody.contains`: `['> Cancel']`
  - `panelBody.contains`: `['  Send']`
  - `panelBody.notContains`: `['> Send']`
- **transitions**:
  - `press` -> back to `sidebar.messages`; `api.sendMessage` MUST NOT have been called
  - `swipeUp` / `swipeDown` -> back to `sidebarConfirm.send`
- **budget**: 500 ms

### 4.15 `sidebarSending`
- **state**: `{ screen: 'sidebarSending', focus: 'messages', chat, topic?, messages, transcript, back }`
- **render**: `{ kind: 'sidebar', title: 'Sending reply', focus: 'panel' }`
- **right**:
  - `panelTitle`: `'Sending...'`
  - `panelBody.contains`: `state.transcript`
  - `panelFooter`: empty
- **transitions**: automatic -> `sidebar.messages` with `state.status === 'Sent'`
- **budget**: 2000 ms
- **apiCalls**: `sendMessage`

### 4.16 `sidebarSent`
- **state**: `{ screen: 'sidebarSent', focus: 'messages', chat, topic?, messages, back }`
- **render**: `{ kind: 'sidebar', title: 'Reply sent', focus: 'panel' }`
- **right**:
  - `panelBody.contains`: outgoing message text
  - `panelFooter`: `'Click record | Double click back'`
- **transitions**:
  - `press` -> `sidebarRecording`
  - `doublePress` -> `back`
- **budget**: 500 ms

### 4.17 `newMessage.normal` (incoming message notification, normal chat)
- **state**: `{ screen: 'newMessage', chat, message, chats, selectedChatIndex }`
- **render**: `{ kind: 'text', title: 'New Telegram' }`
- **body.contains**: `[chat.title, 'New message', 'Click to open']`
- **body.notContains**: stale chat name
- **footer.contains**: `['Double click dismiss']`
- **transitions**:
  - `press` -> `sidebar.messages.normal` for `state.chat`
  - `doublePress` -> `asleep`
- **budget**: 1000 ms from `TelegramUpdate`
- **apiCalls**: `listChats` triggered internally

### 4.18 `newMessage.topic`
- **state**: same as `newMessage.normal` with `topic` set
- **body.contains**: `[chat.title, topic.title]` (e.g. `'Fixture Forum / Fixture Topic One'`)
- **transitions**: `press` -> `sidebar.messages.topic`

### 4.19 `asleep` (screen off)
- **state**: `{ screen: 'asleep', chats, selectedChatIndex }`
- **render**: `{ kind: 'text', title: '', body: '' }`
- **transitions**:
  - `press`, `swipeUp`, `swipeDown` -> stays; calls `turnScreenOff` on every input
  - `doublePress` -> `sidebar.chats` with previous `selectedChatIndex`
- **budget**: 500 ms
- **eventMustEmit**: `lifecycle.kind === 'asleep'`, then `lifecycle.kind === 'wake'`

### 4.20 `error`
- **state**: `{ screen: 'error', message, previous? }`
- **render**: `{ kind: 'text', title: 'Error' }`
- **body.contains**: `[state.message, 'Press to retry']`
- **body.contains** (with previous): `['Double press back']`
- **transitions**:
  - `press` -> re-runs `init()`
  - `doublePress` with `state.previous` -> `state.previous`
- **budget**: 1000 ms

## 5. Test execution order

|#|Step name|Input|Expected target|Extra assertions|
|---|---|---|---|---|
|00|`00-startup-loading`|(boot)|`loading`|first render after `init`|
|01|`01-chats-startup`|(after `init`)|`sidebar.chats`|`selectedChatIndex === 0`, panel shows `Fixture Alpha`|
|02|`02-chats-swipe-down-1`|`swipeDown`|`sidebar.chats`|`selectedChatIndex === 1`, panel shows `Fixture Forum`|
|03|`03-chats-swipe-down-2`|`swipeDown`|`sidebar.chats`|`selectedChatIndex === 2`, panel shows `Fixture Ops`|
|04|`04-chats-swipe-down-3`|`swipeDown`|`sidebar.chats`|`selectedChatIndex === 3`, panel shows `Fixture Research`|
|05|`05-chats-swipe-up-1`|`swipeUp`|`sidebar.chats`|`selectedChatIndex === 2`|
|06|`06-chats-swipe-up-2`|`swipeUp`|`sidebar.chats`|`selectedChatIndex === 1`|
|07|`07-chats-swipe-up-3`|`swipeUp`|`sidebar.chats`|`selectedChatIndex === 0`|
|08|`08-chats-open-forum-topics`|`press`|`sidebar.topics.noPreview`|panel shows `Loading messages...`|
|08a|`08a-topics-fast-open-before-preview`|`click` on first topic|`sidebar.messages.topic`|message fetch must use `topic.id`; preview cache MUST populate for the just-opened topic so a back-then-swipe shows content, not `Loading messages...`|
|08b|`08b-topics-back-shows-loading`|`doublePress`|`sidebar.topics.noPreview`|back to topics must show `Loading messages...` (preview cache was cleared on open) — a back-after-preload MUST keep the cached preview|
|08c|`08c-topics-swipe-preview-from-cache`|`swipeDown`|`sidebar.topics.preview` (topic 1)|panel must show `fixture-topic-one-body` from the cache, not a fresh fetch|
|08d|`08d-topics-swipe-back-cached-preview`|`swipeUp`|`sidebar.topics.preview` (topic 0)|panel must show `Topic zero warmup body` from the cache; this catches a regression where the swipe handler blanks the right panel on cached-only topics|
|09|`09-topics-preview-loaded`|(wait)|`sidebar.topics.preview`|panel shows topic 0 preview|
|10|`10-topics-swipe-down-1`|`swipeDown`|`sidebar.topics.preview` (topic 1)|panel must show `fixture-topic-one-body`|
|11|`11-topics-open-topic-one`|`press`|`sidebar.messages.topic`|left marker on topic 1, panel shows both messages; render must NOT contain `Topic zero warmup body` (catches stale-topic preview leaking through to messages view)|
|12|`12-topic-messages-scroll-older`|`swipeUp`|`sidebar.messages.topic` (older page)|`state.status` contains `Loading older` then older text|
|13|`13-topic-messages-back`|`doublePress`|`sidebar.topics.preview`|returns to topics, NOT chats; right panel must show `fixture-topic-one-body` (the topic we just left) and MUST NOT show `Topic zero warmup body`|
|14|`14-topics-swipe-down-2`|`swipeDown`|`sidebar.topics.preview` (topic 2)|panel must show `fixture-topic-two-body` from the prefetch cache|
|15|`15-topics-open-topic-two`|`press`|`sidebar.messages.topic`|`api.listMessages.args.topicId === 'fixture-topic-2'`|
|16|`16-topic-two-back`|`doublePress`|`sidebar.topics.preview`|back to topics; panel must show `fixture-topic-two-body` (the topic we just left), not a stale `Loading messages...`|
|17|`17-topics-swipe-down-3`|`swipeDown`|`sidebar.topics.preview` (topic 3)|panel must show the topic-3 long-message anchor (catches a regression where the swipe handler does not hydrate the right panel for cached topic 3)|
|18|`18-topics-open-topic-three`|`press`|`sidebar.messages.topic`|panel shows topic 3 messages|
|19|`19-topic-three-back`|`doublePress`|`sidebar.topics.preview`|back to topics|
|20|`20-topics-double-back-to-chats`|`doublePress`|`sidebar.chats`|`selectedChatIndex === 1` preserved|
|21|`21-chats-open-alpha`|`swipeUp` + `press`|`sidebar.messages.normal`|chat 0, both messages, `markRead` called|
|22|`22-alpha-record-start`|`press` (delay 0)|`sidebarRecording`|`setAudioEnabled(true)`|
|23|`23-alpha-record-audio-1`|`audioChunk` x 1|`sidebarRecording`|`state.chunks.length === 1`|
|24|`24-alpha-record-audio-2`|`audioChunk` x 1|`sidebarRecording`|`state.chunks.length === 2`|
|25|`25-alpha-record-audio-3`|`audioChunk` x 1|`sidebarRecording`|`state.chunks.length === 3`|
|26|`26-alpha-record-stop`|`press`|`sidebarTranscribing`|`setAudioEnabled(false)`|
|27|`27-alpha-transcribe-done`|(wait)|`sidebarConfirm.send`|transcript === `'Fixture transcript'`|
|28|`28-alpha-confirm-send`|`press`|`sidebarSending` -> `sidebar.messages.normal`|outgoing message present, `sendMessage` called|
|29|`29-chats-reload`|(back)|`sidebar.messages.normal` (chat 2)|both Ops messages visible|
|30|`30-ops-record-cancel-doublepress`|`press` -> `press` -> `doublePress`|`sidebar.messages.normal`|`transcribe` NOT called|
|31|`31-ops-record-confirm-cancel`|`press` -> `press` -> `swipeDown` -> `press`|`sidebar.messages.normal`|`sendMessage` NOT called|
|32|`32-chats-asleep`|`doublePress` (from chats)|`asleep`|`turnScreenOff` called once, `lifecycle === 'asleep'`|
|33|`33-asleep-noop-press`|`press`|`asleep`|`turnScreenOff` called again, state stays|
|34|`34-asleep-wake`|`doublePress`|`sidebar.chats`|`selectedChatIndex` preserved, `lifecycle === 'wake'`|
|35|`35-newmessage-inject`|`TelegramUpdate` via `/api/test/notify`|`newMessage.normal`|body contains chat title and `New message`|
|36|`36-newmessage-open`|`press`|`sidebar.messages.normal`|`listMessages` called for that chat|
|37|`37-error-inject`|`error` mode then `init`|`error`|body contains `Error` and `Press to retry`|
|38|`38-error-retry`|`press`|(re-runs `init`)|`authStatus` called again|
|39|`39-perf-budget-chat-list`|`slow` mode then `init`|`sidebar.chats` after 1200 ms|harness FAILS with clear latency-budget message|

## 6. Fixture data dictionary

| Field | Value |
| --- | --- |
| `fixtureChats[0]` | `{ id: 'fixture-chat-0', title: 'Fixture Alpha', kind: 'user', lastMessage: 'Alpha preview baseline for startup selection.' }` |
| `fixtureChats[1]` | `{ id: 'fixture-chat-1', title: 'Fixture Forum', kind: 'group', isForum: true, unreadCount: 3, lastMessage: 'Forum preview: topic content is available.' }` |
| `fixtureChats[2]` | `{ id: 'fixture-chat-2', title: 'Fixture Ops', kind: 'group', lastMessage: 'Ops preview: deployment status green.' }` |
| `fixtureChats[3]` | `{ id: 'fixture-chat-3', title: 'Fixture Research', kind: 'channel', lastMessage: 'Research preview: visual validation sample.' }` |
| `fixtureChats[4]` | `{ id: 'fixture-chat-4', title: 'Fixture Archive', kind: 'group', lastMessage: 'Archive preview: older test data.' }` |
| `fixtureTopics[*]` | Four topics: `id: 'fixture-topic-0..3'`, `topMessageId: 'fixture-topic-N-top'`, `unreadCount: 1` on 1,2,3. |
| `messagePages[fixture-chat-0]` | Two messages, second is outgoing from `Me`. |
| `messagePages[fixture-chat-1, fixture-topic-0]` | One warmup message. |
| `messagePages[fixture-chat-1, fixture-topic-1]` | Two messages including `fixture-topic-one-body`. |
| `messagePages[fixture-chat-1, fixture-topic-2]` | Two messages including `fixture-topic-two-body`. |
| `messagePages[fixture-chat-1, fixture-topic-3]` | Two messages including `fixture-topic-three-body`. |
| `transcribe()` | Returns `{ text: 'Fixture transcript' }` unless overridden via `/api/test/transcript`. |
| `sendMessage()` | Generates outgoing message with `id: Date.now()`. Recorded in `__fixture.sent`. |

## 7. Blank-detection rules

The glasses screenshot is BLANK (and the step fails) when ALL of the following are true:
- `uniqueNonTransparentColors <= 5`
- All non-transparent colors are within Euclidean distance 30 of the LVGL selection-border green `(0, 255, 0, alpha)` for some alpha in `[0, 255]`

Otherwise the screenshot is considered rendered. The harness additionally computes:
- `nonTransparentPixelCount`
- `dominantRegion` (4x4 grid of average color, downsampled)
- `textLikePixelCount` (pixels with `R > 20 || B > 20`)

A regression check asserts that no step has `textLikePixelCount === 0` AND the render model contained text. If that combination happens, the harness fails with `Glasses screenshot has no text pixels for a screen that has text content`. This is the exact regression that hid the user's reported bug.

## 8. Webview fallback

When the glasses screenshot is blank per the rules above, the harness additionally:
- Locates the embedded 576x288 LVGL frame in the webview screenshot (by color signature)
- Computes the same three structural metrics on that region
- Asserts the metrics fall in the expected range (e.g. `textLikePixelCount >= 200` for the chat list)
- If the webview region also has `textLikePixelCount < 200`, the harness fails with a clear message

This validates visual correctness even when the simulator's `/api/screenshot/glasses` is empty (the current state of `@evenrealities/evenhub-simulator@0.7.2`). The webview check is only a fallback; as soon as the simulator renders text, the harness switches back to glasses-only.

## 9. Coverage additions to keep queued

These screens already exist in the app and the catalog, but they should stay explicitly covered by harness steps so regressions are visible instead of implied:

| Screen | Step shape | Expected assertion |
| --- | --- | --- |
| `auth.needsSetup` | fixture auth mode `missing` | `state.mode === 'needsSetup'` and body includes `Settings` |
| `auth.signedOut` | fixture auth mode `signed-out` | `state.mode === 'signedOut'` and body includes `phone number` |
| `auth.phonePending` | drive phone login from fixture mode | `state.mode === 'phonePending'` and body includes `code` |
| `sidebar.messages.loading` | slow message open or older-page fetch | body/footer show `Loading...` before the data render |
| `sidebarSent` | after phone-sent or send-reply flow | `state.screen === 'sidebarSent'` before returning to message view |
| `newMessage.topic` | injected notification with `topicId` | body includes both chat title and topic title |

Harness detail:
- The fixture path should be able to select `teleGlanceAuth=missing`, `teleGlanceAuth=signed-out`, and a phone-pending login path independently through either a URL override or a dedicated fixture command.
- The topic notification step should inject `topicId` so the notification screen proves the forum-topic branch, not the normal-chat branch.
- The loading-state assertion should capture the transient state itself, not only the final post-load screen.
