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

- Backend URL save/reset.
- Debug event logging toggle.
- Chat polling interval in milliseconds.
- Message polling interval in milliseconds.
- Recording minimum duration in milliseconds.
- Read-only current API URL.
- Read-only app/build version.

Changing the backend URL requires a reload so the API client and controller restart from a consistent base URL. Polling and recording settings are applied live to the controller.

## Controller Contract

The controller exposes phone-facing APIs in addition to glasses input dispatch:

- `subscribe(listener)`: notify React whenever controller state changes.
- `snapshot`: current `AppState`.
- `sendTextFromPhone(text)`: send a typed reply to the active chat/topic.
- `updateRuntimeConfig(config)`: update polling and recording timing.

`sendTextFromPhone(text)` only works while the controller is in a state with an active message thread. It sends to the current chat/topic, refreshes newest messages, normalizes ordering, resets the visible pointer to latest, and re-renders glasses.

## Glasses Message Projection

`screenModel` is a glasses-only projection and owns the 576x288 constraints:

- It builds bottom-anchored visible pages from the chronological message buffer.
- Compact messages are grouped into full visible pages.
- Messages over twenty-five words become structured boxed pages.
- Multi-page boxed messages remain separate scroll stops until the user reaches the first/last page.
- The returned `body` remains useful for the phone/debug pane, but the glasses bridge uses structured `box` metadata for native bordered containers.

Avoid parsing ASCII/debug text to infer native glasses layout. That caused duplicated text-box content because the native container and the old marker format could both render.

## Realtime Updates

The backend exposes `/api/updates` as an SSE stream for Telegram message updates. The React context subscribes once, forwards matching updates to the shared controller, and the controller refreshes the active thread or root chats as needed.

## Hardware Notes

The browser/debug pane and glasses display are not interchangeable for layout validation. The G2 display is not a true monospace grid, so long-message borders on glasses must use native `TextContainerProperty` borders rather than text-drawn rectangles.

Hardware input can emit duplicate same-direction swipes. Event mapping debounces those bursts so one physical gesture advances one message page.

## Validation

Required checks:

- `npm run typecheck --prefix web`
- `npm test --prefix web`
- `PYTHONPYCACHEPREFIX=.pycache server/.venv/bin/python -m pytest tests/backend`
- `npm run build:tailscale --prefix web`
