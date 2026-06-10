# Frontend Architecture

## Summary

The frontend has two separate rendering targets:

- Phone/debug UI: a React DOM app for configuration, message browsing, and typed replies.
- Glasses UI: the existing Even Hub 576x288 container UI driven by `screenModel`.

Both targets share the same Telegram controller so the phone and glasses stay synchronized. The phone UI must not reuse `screenModel` for rich DOM rendering; `screenModel` remains a glasses-only projection with byte and visible-line limits.

## Structure

- `web/src/main.tsx`: React bootstrap.
- `web/src/App.tsx`: phone app shell and screen switching.
- `web/src/contexts/AppContext.tsx`: owns `HttpTelegramApi`, `EvenHubGlassesBridge`, and `TelegramAppController`.
- `web/src/screens/ChatScreen.tsx`: phone message view plus typed composer.
- `web/src/screens/SettingsScreen.tsx`: frontend-only configuration.
- `web/src/storage.ts`: typed localStorage config defaults.
- `web/src/controller/*`: shared app state machine and glasses screen model.
- `web/src/bridge/*`: Even Hub bridge and event mapping.

The glasses bridge is created once and is not recreated while switching between phone screens.

## Phone UI

The phone chat screen shows full DOM message history, separate from the glasses view:

- Chat/topic title when a thread is active.
- Full messages oldest-to-newest with sender labels.
- Scrollable message list that stays at the latest message after open/send/receive.
- Separate text box and Send button for typed phone replies.
- Empty states for auth, chat list, topic list, asleep, new-message prompt, and errors.

The phone composer sends directly to the currently open Telegram chat/topic. It does not enter the glasses voice-recording confirmation flow. After send, the controller refreshes the latest messages and keeps the glasses screen anchored to the latest message.

## Settings

Settings are frontend-specific and persisted in localStorage.

Practical V1 settings:

- First-use Telegram API ID/API hash setup with `my.telegram.org` instructions.
- Required backend shared secret setup. The same `TELEGLANCE_SHARED_SECRET` value must be configured in backend `.env` and phone Settings.
- Frontend-local Telegram StringSession status and clear-session action. The UI describes this as stored on the phone only.
- Login action after credentials are configured: phone-code login with an international-format mobile number. QR login has been removed from the app and backend API surface.
- Backend setup instructions with `https://github.com/jalatif/even-g2-tele-glance.git`.
- Backend URL save/reset.
- Optional STT Server Url override; blank uses the backend URL and backend-local `faster-whisper`.
- Debug event logging toggle.
- Recording minimum duration in milliseconds.
- Advanced fallback refresh intervals for chat/message polling, hidden behind details because SSE is the primary update path.
- Read-only current API URL and session status.
- Read-only app/build version.

Changing backend URL, STT URL, backend shared secret, Telegram credentials, or the Telegram session requires a reload so the API client and controller restart from a consistent identity. Recording and fallback refresh settings are applied live to the controller.

Telegram API hash, shared secret, and session string are sensitive. They are kept out of backend disk storage in the public setup path, but localStorage is still only appropriate for a self-hosted/user-owned deployment.

## Controller Contract

The controller exposes phone-facing APIs in addition to glasses input dispatch:

- `subscribe(listener)`: notify React whenever controller state changes.
- `snapshot`: current `AppState`.
- `sendTextFromPhone(text)`: send a typed reply to the active chat/topic.
- `updateRuntimeConfig(config)`: update polling and recording timing.

`sendTextFromPhone(text)` only works while the controller is in a state with an active message thread. It sends to the current chat/topic, refreshes newest messages, normalizes ordering, resets the visible pointer to latest, and re-renders glasses.

Phone-code login returns `sessionString`; the React context persists it to localStorage and all later Telegram API requests include it inside encrypted `X-TeleGlance-Auth`.

## Glasses Message Projection

`screenModel` is a glasses-only projection and owns the 576x288 constraints:

- It builds bottom-anchored visible pages from the chronological message buffer.
- Compact messages are grouped into full visible pages.
- Messages over twenty-five words become structured boxed pages.
- Multi-page boxed messages remain separate scroll stops until the user reaches the first/last page.
- The returned `body` remains useful for the phone/debug pane, but the glasses bridge uses structured `box` metadata for native bordered containers.
- For any page that returns `box`, the glasses projection must keep that page's right-panel `body` empty. This prevents old text-drawn box content from rendering underneath the native bordered container.
- Forum topic preview panels render the selected topic plus loading copy until preview messages arrive; they should not mirror the full topic list from the left sidebar.

Avoid parsing ASCII/debug text to infer native glasses layout. That caused duplicated text-box content because the native container and the old marker format could both render.

## Realtime Updates

The backend exposes `/api/updates` as an SSE stream for Telegram message updates. The React context subscribes once, forwards matching updates to the shared controller, and the controller refreshes the active thread or root chats as needed.

The frontend intentionally uses `fetch` streaming instead of browser `EventSource` because `EventSource` cannot attach encrypted app auth headers. Credentials/session must not be put in query parameters.

## Hardware Notes

The browser/debug pane and glasses display are not interchangeable for layout validation. The G2 display is not a true monospace grid, so long-message borders on glasses must use native `TextContainerProperty` borders rather than text-drawn rectangles.

Hardware input can emit duplicate same-direction swipes. Event mapping uses a narrow 30ms duplicate window so immediate duplicates are filtered without dropping deliberate rapid navigation.

Chat/topic navigation uses a text-rendered sidebar and one full-screen event overlay. The controller owns the selected index and updates the visible marker and right-side preview together. Native item-name/index payloads remain compatibility inputs rather than the primary selection mechanism.

The initial chat list renders before speculative work. A delayed idle prefetch warms only the next two chats, and forum warming is limited to one topic. Hardware input is collapsed to the latest gesture in a 20 ms delivery burst so SDK/native stalls cannot release a long sequence onto later screens.

Chat and topic selection retain the split sidebar/preview layout. Opening the selected thread expands messages across the full glasses width; double click restores the saved split-view back target. Voice transcription confirmation is a standalone text page containing the transcript and `Send`/`Cancel` choices.

## Validation

Required checks:

- `npm run typecheck --prefix web`
- `npm test --prefix web`
- `PYTHONPYCACHEPREFIX=.pycache server/.venv/bin/python -m pytest tests/backend`
- `npm run build:tailscale --prefix web`
