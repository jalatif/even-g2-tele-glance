# Even G2 Telegram Glasses App Plan

## Summary

Build a fresh Even Hub app in this workspace with:

- A Vite/TypeScript glasses frontend using `@evenrealities/even_hub_sdk`.
- A local FastAPI backend using Telethon/MTProto for the owner's real Telegram account.
- Local Whisper transcription using `faster-whisper`.
- Local-first development with the Even Hub simulator and QR sideloading before any cloud deployment.

Use MTProto rather than a Telegram bot because v1 needs access to the user's real Telegram inbox: recent users/groups, message history, and forum topics. Bot-only access cannot replicate the desktop/mobile Telegram inbox.

## Key Changes

- Scaffold a two-part app:
  - `web/`: Even Hub glasses UI, SDK bridge, touch/audio event handling, API client.
  - `server/`: FastAPI API, Telethon Telegram session, local Whisper transcription, CORS for local dev.
- Add `app.json` for Even Hub with:
  - `network` permission for the backend origin.
  - `g2-microphone` permission for voice commands.
  - `min_sdk_version` set to the current SDK baseline.
- Store secrets and sessions only server-side:
  - `TELEGRAM_API_ID`
  - `TELEGRAM_API_HASH`
  - `server/data/telegram.session`
  - Whisper config such as `WHISPER_MODEL=small`, `WHISPER_DEVICE=auto`, `WHISPER_COMPUTE_TYPE=int8`.

## Telegram Backend

- Implement Telegram login with QR-code auth first, with phone-code fallback if QR auth is unavailable.
- Normalize backend API responses so the glasses frontend never handles raw Telegram entities:
  - `GET /api/auth/status`
  - `POST /api/auth/qr/start`
  - `GET /api/chats?limit=5`
  - `GET /api/chats/{chat_id}/topics`
  - `GET /api/chats/{chat_id}/messages?topic_id=&before_id=&limit=8`
  - `POST /api/chats/{chat_id}/messages`
  - `POST /api/transcribe`
- Fetch the last 5 dialog threads from Telegram.
- For normal chats, fetch history with `messages.getHistory`.
- For forum groups, fetch topics with `channels.getForumTopics`; fetch topic messages using the topic top-message id via reply-thread history.
- Send plain text only:
  - Normal chat: send to peer.
  - Forum topic: send with reply metadata targeting the topic top-message id.
- Exclude calls, contact search, media sending, secret chats, and Telegram-wide search from v1.

## Glasses UX

- Use Even Hub's 576x288 container UI constraints:
  - Native list container for chat selection.
  - Native list container for topic selection when topics exist.
  - Text container for message history, relying on firmware scrolling when content overflows.
  - Text/list confirmation screen for sending.
- Navigation:
  - Chat list: swipe up/down changes selection, single press selects.
  - Topic list: swipe up/down changes selection, single press selects; no-topic chats skip this screen.
  - Message view: swipe scrolls older/recent messages; double press goes back.
  - Recording fallback, because the documented SDK exposes press/double/swipe but not true hold:
    - Single press starts recording.
    - Single press stops recording and transcribes.
    - Confirmation shows `Send` and `Cancel` as selectable items.
    - Swipe changes selected confirmation action.
    - Single press executes the highlighted action.
- Audio flow:
  - Start/stop `bridge.audioControl(true/false)`.
  - Collect 16 kHz signed 16-bit little-endian PCM chunks from `audioEvent`.
  - Send WAV-wrapped audio to `/api/transcribe`.
  - Show transcript before sending.
  - Show clear states: recording, transcribing, confirm, sending, sent, error.

## Test Plan

- Backend tests:
  - Auth status without session.
  - Chat normalization from mocked Telegram entities.
  - Topic detection and topic message pagination.
  - Send payload generation for normal chats and topic chats.
  - PCM-to-WAV wrapping and Whisper transcription endpoint with a tiny fixture.
- Frontend tests:
  - State machine transitions: auth, chats, topics, messages, recording, confirmation.
  - Event mapping for press, double press, swipe up/down.
  - API error states and retry surfaces.
- Integration checks:
  - Run Vite app in the Even simulator.
  - Verify nonblank 576x288 screens.
  - Verify list navigation, message scrolling, recording state, and confirmation flow.
  - Test on real G2 hardware before packaging because simulator input and scrolling can differ.

## Assumptions

- The repo is intentionally empty, so implementation starts from a new scaffold.
- v1 is for the owner's Telegram account, not a multi-user hosted service.
- Local Whisper is preferred over cloud STT.
- Local-first backend runs on the same LAN as the phone during QR sideload testing.
- The frontend calls only the backend, not Telegram directly, to avoid exposing MTProto credentials/session data and to avoid WebView/CORS issues.
- References used while preparing this plan: Even Hub overview, display, input, device APIs, networking, simulator, packaging docs; Telegram MTProto auth, QR login, dialogs, history, replies, forum topics, and sendMessage docs.

## Current Implementation Status

- Repository scaffold is initialized with a Vite/TypeScript frontend, FastAPI backend, app manifest, tests, and simulator validation notes.
- Backend service boundaries are implemented for Telegram MTProto, normalized DTOs, QR-login start, message/topic/history APIs, and local Whisper transcription.
- Frontend controller is implemented for auth, chats, topics, messages, recording, transcription, send/cancel confirmation, and Even Hub input/audio event mapping.
- Current validation passes:
  - `PYTHONPYCACHEPREFIX=.pycache server/.venv/bin/python -m pytest tests/backend`
  - `npm run typecheck --prefix web`
  - `npm test --prefix web`
  - `npm run build:tailscale --prefix web`
  - `npx --yes @evenrealities/evenhub-cli pack app.json web/dist -o even-telegram-0.1.2.ehpk`
- Even Hub simulator smoke validation passes for startup rendering, automation health, screenshot capture, and click input. With no Telegram credentials configured, the expected QR-login error screen renders cleanly.
- Telegram app credentials have been configured locally in ignored `server/.env`.
- QR login now uses a backend pending-login state, background Telethon wait task, status endpoint, and local PNG QR endpoint. Simulator validation confirms the browser/debug view shows a scannable QR code.
- Telegram session persistence resolves `TELEGRAM_SESSION_PATH` from the repository root so the same local Telethon session is reused whether the backend starts from the repo root or `server/`.
- Forum topic message history/sending uses the forum `topic.id` for Telethon 1.43; `topMessageId` remains in the DTO for display/debug context.
- Even Hub page rebuilds now use stable title/body/list container IDs so stale topic-list containers do not remain visible after transitioning to message history in the simulator.
- Even Hub container output is capped for SDK constraints: text content <=999 UTF-8 bytes and list item count 1-20.
- Message history uses page-style navigation for the glasses display: the current page is byte-bounded for the SDK, swipe up fetches the next older page, and swipe down reloads the newest page.
- Message pages now carry an explicit back target so double press returns to the topic list or chat list instead of interacting with message pagination.
- Even Hub click input is coalesced so two rapid click events become one `doublePress`; single-click actions such as recording start only after the double-click window expires.
- List click events now carry their selected item index into chat/topic opening so the app does not open a stale topic after scrolling.
- After sending a message, the frontend starts a short non-blocking refresh poll so quick Telegram replies appear in the glasses message view.
- List selection changes update controller state without rebuilding the Even Hub list container, preventing simulator/glasses selection from snapping back to the first item.
- Text pages use a separate footer/banner container for controls such as click-to-record and double-click-back so message content stays distinct.
- Open message threads show `Checking replies...` in the footer while polling for new messages; after sending, the app returns to the message screen instead of staying on a separate sent page.
- Message pages normalize API results into oldest-to-newest order before display, keep the latest page anchored as the bottom page, and prevent swipe-down from cycling/reloading when already at the newest page.
- Sending a message refreshes the newest page before display; incoming replies detected while reading older pages automatically jump the message view back to the newest/bottom page, while unchanged polls leave older pages in place.
- Tailscale is the default device-test backend route. `TAILSCALE_ENABLED=true` enables CORS for Tailscale 100.64.0.0/10 origins, and `npm run configure:tailscale --prefix web` writes `web/.env.local` plus updates `app.json` with the detected backend origin.
- Device input mapping now runs raw Even Hub events through the SDK parser and a fallback mapper that accepts proto-style keys, snake_case keys, numeric strings, and press/tap aliases. This is intended to handle real G2 payloads where list scrolling works but single-click selection is not shaped like the simulator event.
- The app manifest version has been bumped to `0.1.2` so the packaged `.ehpk` metadata now matches the file name.
- A hardware-test package has been built at `even-telegram-0.1.2.ehpk` after the device click-mapping fix.
- Real Telegram login has succeeded and `server/data/telegram.session` is present locally.
- Real chat loading, forum topic listing, and forum topic message loading have been validated against the Akira Agents group. For Telethon 1.43, forum message history uses the forum `topic.id`, not `topMessageId`; `topMessageId` remains part of the DTO for display/debug context.
- Frontend now ignores too-short/all-zero simulator audio recordings instead of invoking Whisper on silent audio.

## Observed Issues and Learnings

- Even Hub text/list container limits are strict on device and simulator. Message display must be byte-bounded, not character-bounded, because content over 999 UTF-8 bytes can fail rendering or leave the glasses on a stale screen.
- Stable container IDs matter. Rebuilding from topic list to message view with different or stale IDs can make the browser/debug view look correct while the glasses display remains on the previous page.
- The simulator and real G2 hardware can emit input events with different shapes. Scroll events can work while click events do not, so event mapping must accept normalized SDK objects and raw/protobuf-like payloads.
- The SDK can normalize `CLICK_EVENT` value `0` to `undefined` in some paths. Treat `undefined` event type on an event-capturing text/list container as single press.
- Single-click and double-click cannot be handled as immediate independent events without coalescing. Single-click actions must wait briefly for the double-click window, otherwise double press is seen as two single presses.
- List selection state should not trigger a full list rebuild on every swipe. Rebuilding can snap selection back to the first item and cause stale chat/topic openings.
- List click handling should prefer the selected index from the click event when present. Relying only on controller state can open the wrong item after hardware-side scrolling.
- On real G2 hardware, a list click may surface only as a selection event with the same index already highlighted. Chats/topics should interpret `selectIndex` on the current item as a press so users can open a thread without relying on simulator-style click payloads.
- Message ordering must be normalized oldest-to-newest after every Telegram API response. Telegram pagination and new-message refreshes can otherwise make the visible conversation order appear jumbled.
- The newest message page should be treated as the bottom boundary. Scrolling down at the bottom should stay there, not cycle pages or reload history in a way that changes order.
- After send or incoming reply detection, the message view should jump to the newest/bottom page because that matches Telegram user expectations.
- Real Telegram forum topics in Telethon 1.43 use `topic.id` for message history in this implementation. `topMessageId` is still useful DTO/debug context but should not be assumed to be the fetch key.
- Telegram session path resolution must be stable across working directories. Resolve `TELEGRAM_SESSION_PATH` from the repository root so login persists whether the backend is launched from `server/` or the repo root.
- For device testing, the backend is not packaged into `.ehpk`. The `.ehpk` contains the frontend and manifest; the FastAPI backend must stay running and reachable from the phone/glasses path.
- Tailscale is a practical local device-test route, but the phone running the Even Realities app must be able to reach the Tailscale backend URL in `app.json` and `web/.env.local`.
- Simulator microphone input can produce silent/all-zero audio. Guarding that path avoids unnecessary Whisper calls and confusing transcription errors during simulator validation.

## Pending Checklist

- Validate `even-telegram-0.1.2.ehpk` on real G2 hardware to confirm the broader click-event mapper fixes chat/topic selection.
- If hardware clicks still fail, add a temporary debug screen or backend log endpoint that displays the raw last Even Hub event payload on the glasses/browser.
- Add real Telegram update subscriptions or a server-sent events/WebSocket stream for incoming messages and typing indicators. Current behavior is polling/checking status, not true live typing presence.
- Add production-grade backend process management for device testing, such as a launch script, `uvicorn` service wrapper, health check, and clearer restart instructions.
- Decide whether production should use Tailscale HTTP, Tailscale Serve HTTPS, a LAN URL, or a hosted HTTPS backend. Update `app.json` whitelist and frontend config accordingly.
- Add a package/version script that builds Tailscale output and writes a versioned `.ehpk` in one command.
- Before every repack, bump `app.json` `version` first and delete stale `.ehpk` outputs so the workspace only keeps the latest package artifact.
- Add on-device QA cases for phone locked/backgrounded, idle for 2+ minutes, returning from another phone app, root-page exit behavior, and recovery after backend disconnect.
- Add stronger backend tests for real-ish Telethon forum topic pagination and send-message payloads using saved mocked entity fixtures.
- Add a user-facing reconnect/retry state when the backend is unreachable after the packaged app launches.
- Review privacy/security before any external distribution: MTProto credentials, local session file handling, backend network exposure, CORS scope, and whether multi-user hosting is explicitly unsupported.
- Consider rate limiting or debounce on send/transcribe actions so accidental repeated taps do not duplicate Telegram sends.
- Improve audio UX on real hardware after testing actual G2 microphone payloads, including minimum duration, empty transcript handling, and confirmation copy.
- Add a private-build release checklist covering tests, packaging, backend reachability from phone, Telegram auth status, and a short real-message send/receive smoke test.
