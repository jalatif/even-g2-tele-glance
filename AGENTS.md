# TeleGlance Glasses App Plan

## Summary

Build a fresh Even Hub app in this workspace with:

- A Vite/TypeScript glasses frontend using `@evenrealities/even_hub_sdk`.
- A local FastAPI backend using Telethon/MTProto for the user's real Telegram account.
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
- Public self-hosted setup stores Telegram API credentials, the required backend shared secret, and the MTProto StringSession in phone localStorage, then sends credentials/session to the backend inside encrypted `X-TeleGlance-Auth`.
- Telegram credentials/session are not supported as backend environment settings.
- Root `.env` must include `TELEGLANCE_SHARED_SECRET`; other root `.env` config is limited to backend overrides such as CORS, Tailscale, and Whisper STT tuning.

## Telegram Backend

- Implement Telegram login with phone-code auth only. QR login has been removed from the app and backend API surface.
- Normalize backend API responses so the glasses frontend never handles raw Telegram entities:
  - `GET /api/session/status`
  - `POST /api/session/phone/start`
  - `POST /api/session/phone/verify`
  - `POST /api/session/logout`
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
## Testing Infrastructure
Three test surfaces, each with a different scope:

### 1. Unit tests (`npm test --prefix web`)

Vitest tests for pure logic: model, event mapping, storage, controller state machine, evenBridge. No Vite, no simulator, no backend. Fast (~400ms total).

### 2. Simulator fixture harness (`npm run test:simulator --prefix web`)

Drives the 48-step catalog from `docs/UI_INVARIANTS.json` through a fixture-backed instance of the app. The Vite plugin sets `VITE_TELEGLANCE_FIXTURE=1` so the frontend uses deterministic fixture data instead of real Telegram. This validates the full UI flow without a backend or real session.

### 3. Fuzzy test runner (`npm run test:fuzzy --prefix web`)

Drives 100+ random input sequences (up/down/click/double_click) and validates structural invariants after each input. Content-agnostic; works in either mode.

### 4. Real-data mode (`--mode real`)
`npm run test:simulator:real` and `npm run test:fuzzy:real` run against the actual backend and your real Telegram session. The simulator's WebView shares `localStorage` per-origin with the URL it was opened with. The harness uses the same origin (default `http://localhost:5173/`) as the manually-run simulator, so the session you have already populated is reused directly — no re-entry, no phone-code re-verification.
Requirements:
1. The backend must be running (default `http://localhost:8787/`) and reachable from the same host as the simulator.
2. The simulator must have been opened at least once at `http://localhost:5173` with valid Telegram credentials saved to its `localStorage` (run `npm run dev --prefix web`, then `npx @evenrealities/evenhub-simulator@0.7.2 http://localhost:5173`, then complete the Settings page and phone-code login once).
3. The harness uses the same origin. Override with `VITE_PORT` and `TELEGLANCE_TEST_HOST` env vars if you use different ports or `127.0.0.1` instead of `localhost`.
`logTeleGlanceTest` emits structured `[TeleGlanceTest]` console events that the harness parses to detect state transitions. These are enabled in any dev mode and disabled in production builds.
## Assumptions

## Assumptions

- The repo is intentionally empty, so implementation starts from a new scaffold.
- v1 is for a self-hosted user's Telegram account, not a shared multi-user hosted service.
- Local Whisper is preferred over cloud STT.
- Local-first backend runs on the same LAN or Tailscale network as the phone during sideload testing.
- The frontend calls only the backend, not Telegram directly, to avoid WebView/CORS issues. In public mode it supplies Telegram credentials/session inside encrypted `X-TeleGlance-Auth` from frontend storage.
- References used while preparing this plan: Even Hub overview, display, input, device APIs, networking, simulator, packaging docs; Telegram MTProto auth, phone-code login, dialogs, history, replies, forum topics, and sendMessage docs.

## Current Implementation Status

- Repository scaffold is initialized with a Vite/TypeScript frontend, FastAPI backend, app manifest, tests, and simulator validation notes.
- Backend service boundaries are implemented for Telegram MTProto, encrypted phone-code session APIs, normalized DTOs, message/topic/history APIs, and local Whisper transcription.
- Frontend controller is implemented for auth, chats, topics, messages, recording, transcription, send/cancel confirmation, and Even Hub input/audio event mapping.
- Current validation passes:
  - `PYTHONPYCACHEPREFIX=.pycache server/.venv/bin/python -m pytest tests/backend`
  - `npm run typecheck --prefix web`
  - `npm test --prefix web`
  - `npm run build:tailscale --prefix web`
- `npx --yes @evenrealities/evenhub-cli pack app.json web/dist -o tele-glance-0.1.2.ehpk`
- Even Hub simulator smoke validation passes for startup rendering, automation health, screenshot capture, and click input. With no Telegram credentials configured, the expected phone-code setup screen renders cleanly.
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
- Tailscale is the default device-test backend route. `TAILSCALE_ENABLED=true` enables CORS for Tailscale 100.64.0.0/10 origins, and `npm run configure:tailscale --prefix web` updates `app.json` with the detected backend origin and prints the URL to enter in Settings.
- Device input mapping now runs raw Even Hub events through the SDK parser and a fallback mapper that accepts proto-style keys, snake_case keys, numeric strings, and press/tap aliases. This is intended to handle real G2 payloads where list scrolling works but single-click selection is not shaped like the simulator event.
- The app manifest version has been bumped to `0.1.2` so the packaged `.ehpk` metadata now matches the file name.
- A hardware-test package has been built at `tele-glance-0.1.2.ehpk` after the device click-mapping fix.
- Real Telegram login has succeeded and `server/data/telegram.session` is present locally.
- Real chat loading, forum topic listing, and forum topic message loading have been validated against the Akira Agents group. For Telethon 1.43, forum message history uses the forum `topic.id`, not `topMessageId`; `topMessageId` remains part of the DTO for display/debug context.
- Frontend now ignores too-short/all-zero simulator audio recordings instead of invoking Whisper on silent audio.
- Public setup now collects Telegram API ID/hash on the frontend Settings page with `my.telegram.org` instructions.
- Phone-code login in frontend-credential mode uses Telethon `StringSession` and returns `sessionString` to the frontend; the backend does not persist that session to `server/data`.
- Phone login is gated by backend shared secret plus frontend API ID/API hash configuration. Disconnected public setup must happen from the phone Settings page.
- Frontend API calls send encrypted `X-TeleGlance-Auth`; plaintext `X-Telegram-*` headers and old `/api/auth/*` paths are not supported. The update stream uses `fetch` streaming instead of `EventSource` so encrypted auth is attached without query strings.
- JSON request bodies and JSON responses for Telegram/session APIs are encrypted with `TELEGLANCE_SHARED_SECRET`; CORS must expose `X-TeleGlance-Encrypted` so the frontend knows to decrypt responses.
- `STT Server Url (Optional)` is a frontend override. Blank uses the backend `/api/transcribe` endpoint with local `faster-whisper`; custom STT endpoints never receive Telegram auth headers.
- Settings includes backend setup instructions with `https://github.com/jalatif/even-g2-tele-glance.git` and centralizes backend URL, Telegram credentials, polling, recording, and debug configuration.
- Backend `/api/transcribe` and `/api/debug/events` now require encrypted shared-secret auth when using the main backend. Custom STT endpoints still do not receive Telegram auth headers.
- Sensitive frontend settings remain in localStorage only; Telegram API credentials, MTProto StringSession, and backend shared secret are no longer mirrored to cookies. Older sensitive cookies are removed on save/reset.
- Topic preview state is cleared on topic selection changes and preview reuse is gated by matching topic id, preventing a fast swipe/press from opening one topic with another topic's cached preview.
- Topic screens now show selected-topic loading copy instead of mirroring the full topic list in the right panel before preview messages load, and the first selected topic preview starts immediately when a forum chat opens.
- Topic listing no longer fetches one preview message per topic serially. The backend returns topic metadata quickly; the frontend fetches recent messages only for the selected preview/opened topic.
- Boxed message previews are rendered only through the native `panelBox`; topic preview, recording, and sent states suppress `panelBody` when `panelBox` exists so ASCII box text cannot overlap with the native container.
- Sidebar rebuilds always include the `panel-box` container id, hidden when unused, so boxed message content does not remain stale after transitions to normal text.
- Forum update matching now tolerates Telethon update payloads that carry either `topic.id`, `topMessageId`, or no topic id, so active forum threads refresh immediately instead of waiting for polling.
- Confirmation rendering now marks only the selected `Send` or `Cancel` action.
- Viewing a message page or selected topic preview now posts `/api/chats/{chat_id}/read` with the newest visible message id. Normal chats use Telethon read acknowledgements; forum topics use `messages.ReadDiscussionRequest`.
- Read acknowledgements optimistically clear local unread badges for the opened chat/topic. For loaded forum topics, the parent chat unread count becomes the sum of the other still-unread topics, and saved back targets are updated so stale badges do not return after navigating back.
- Read acknowledgements are deduped per thread/newest visible message id and only sent for locally unread threads or newly arrived active-thread messages. Local unread clearing is folded into the same render that displays messages, avoiding an extra immediate glasses render.
- Selection-only list events are armed after a short delay when chat/topic lists render. This preserves hardware selection-only click support while ignoring initial native list selection events that can otherwise auto-open the first startup chat.
- Message history pagination now renders a `Loading older messages...` panel immediately when the user swipes beyond loaded history, then fetches and merges the older page in the background.
- Packaged phone builds persist frontend settings through Even App SDK local storage, with browser `localStorage` kept as the simulator/development fallback. Telegram API credentials, backend shared secret, and MTProto StringSession are restored from SDK storage before backend auth/controller startup.
- Chat/topic list scroll input updates controller state without rebuilding the glasses page. The native list is allowed to keep moving immediately, while topic previews/message fetches update the right panel asynchronously.
- Hardware input mapping now prefers fast raw-event parsing before the SDK normalizer. Debug event logging is default-off and throttled to one background event at a time so WebCrypto/fetch logging cannot flood the phone input path.
- Hardware input dispatch and glasses rendering are separated from the SDK event callback. Controller state changes enqueue a deferred, coalesced render instead of calling `rebuildPageContainer` synchronously, and slow chat/topic opens keep the sidebar/message surface interactive while the right panel shows loading.
- Controller state changes also defer React phone UI notifications and screen-model formatting. Sidebar-focus pages use a visible native Even Hub list so selection movement is firmware-local instead of requiring a text-container rebuild for every up/down input.
- Even Hub bridge listeners are guarded by an active-listener token and disposed from `AppProvider` cleanup. This prevents React dev StrictMode or simulator SDK unsubscribe gaps from leaving stale listeners that consume the first input or duplicate subsequent inputs.
- Glasses input now opens a short interaction quiet window. During that window, polling refreshes, update-stream processing, topic preview fetches, older-history prefetch, and read acknowledgements are deferred; audio start/stop and visible UI state changes do not await native bridge calls.
- Startup now prefetches latest message pages for the first five visible chats, and for forum chats it prefetches the first five visible topics plus their latest message pages. Prefetches are cached, deduped, and paced with short yields so opening common threads is faster without making startup input synchronous.
- Native list click/select events may include only the selected item name. Chat/topic opening now resolves missing-index events by matching the native item label, including unread-count suffix stripping, before falling back to controller state.
- No-activity root chat refreshes and topic preview loads update controller/cache/read state without repainting the currently focused native list. This prevents delayed background work from resetting the glasses highlight to the first row after the user clicks or pauses.
- Glasses text sanitization now strips unsupported emoji ranges after replacing known status-circle emoji, avoiding LVGL unsupported-glyph warnings observed in simulator runs.
- Automated simulator fixture validation is implemented with `npm run test:simulator --prefix web`. It launches fixture-mode Vite plus `@evenrealities/evenhub-simulator@0.7.2`, drives chat indexes 1-3 and forum topics 1-3, validates deterministic message content, compares `web/test/simulator-goldens`, and writes report/video artifacts under `artifacts/simulator-flow/<timestamp>/`.

## Observed Issues and Learnings

- Even Hub text/list container limits are strict on device and simulator. Message display must be byte-bounded, not character-bounded, because content over 999 UTF-8 bytes can fail rendering or leave the glasses on a stale screen.
- Stable container IDs matter. Rebuilding from topic list to message view with different or stale IDs can make the browser/debug view look correct while the glasses display remains on the previous page.
- Stable container IDs also apply to optional containers. If a sidebar page sometimes omits a previously used container such as `panel-box`, the device can retain stale native content. Keep the same container id present and hide it with an empty 1x1 container when unused.
- The simulator and real G2 hardware can emit input events with different shapes. Scroll events can work while click events do not, so event mapping must accept normalized SDK objects and raw/protobuf-like payloads.
- In Vite dev/React StrictMode, the simulator SDK may keep old Even Hub event listeners alive even after React cleanup. A stale listener can consume the first `down` event without updating the active controller, and duplicate active listeners can skip list rows. Guard event callbacks with an active token in addition to calling SDK unsubscribe.
- The SDK can normalize `CLICK_EVENT` value `0` to `undefined` in some paths. Treat `undefined` event type on an event-capturing text/list container as single press.
- Single-click and double-click cannot be handled as immediate independent events without coalescing. Single-click actions must wait briefly for the double-click window, otherwise double press is seen as two single presses.
- List selection state should not trigger a full list rebuild on every swipe. Rebuilding can snap selection back to the first item and cause stale chat/topic openings.
- List click handling should prefer the selected index from the click event when present. Relying only on controller state can open the wrong item after hardware-side scrolling.
- Some native list click/select payloads identify the selected row by `currentSelectItemName` instead of an index. Tests must cover this shape because otherwise hardware can open the stale controller-selected chat while the visible native highlight is on another row.
- On real G2 hardware, a list click may surface only as a selection event with the same index already highlighted. Chats/topics should interpret `selectIndex` on the current item as a press so users can open a thread without relying on simulator-style click payloads.
- Message ordering must be normalized oldest-to-newest after every Telegram API response. Telegram pagination and new-message refreshes can otherwise make the visible conversation order appear jumbled.
- The newest message page should be treated as the bottom boundary. Scrolling down at the bottom should stay there, not cycle pages or reload history in a way that changes order.
- After send or incoming reply detection, the message view should jump to the newest/bottom page because that matches Telegram user expectations.
- Real Telegram forum topics in Telethon 1.43 use `topic.id` for message history in this implementation. `topMessageId` is still useful DTO/debug context but should not be assumed to be the fetch key.
- Forum update payloads may not use the same topic identifier as history/sending. When already inside a forum thread, treat matching chat id plus `topic.id`, `topMessageId`, or missing topic id as a refresh signal and let the message fetch resolve truth.
- Topic previews are asynchronous cached state and must be tied to the selected topic id. Clearing preview fields on selection change avoids wrong-thread display/send risks if the user swipes and presses before a new preview finishes.
- Topic preview loading should not use the complete topic list as a right-panel fallback. That briefly duplicates the left sidebar and looks like a broken split view; show the selected topic name plus loading copy until preview messages arrive.
- Topic preview and no-op chat polling refreshes must not repaint the active native list. Even delayed background renders can reset the firmware highlight to row 0 while controller state still points elsewhere, causing the next press to feel slow or open the wrong thread.
- Any state that supplies a native `panelBox` must leave `panelBody` empty for that page. Rendering both the old text-drawn box body and the native bordered container causes ghost/jumbled text on the right side.
- Fetching preview messages for every forum topic inside `/topics` scales poorly. A serial 20-topic preview loop can stall the glasses for a long time; return topic metadata first and preview only the selected topic.
- Forum read state has two visible layers: the selected topic badge and the parent chat badge. Clearing only the topic creates a stale group unread count, so local read handling must propagate to the chat list and any saved navigation/back state.
- Read acknowledgements are part of the UI hot path on glasses. Sending them for every selected preview, including already-read topics, can make topic scrolling feel slow because each swipe can add backend/Telegram work; gate and dedupe read calls aggressively.
- Native list containers may emit a selection-only event for the already-selected row during initial render. Treating that immediately as a press can make startup appear frozen by auto-opening a forum chat and launching topic/message fetches before the user clicks.
- Swipe handlers should not await Telegram page loads before rendering feedback. If older/newer history is not already loaded, update the glasses UI first with a loading state and complete network pagination asynchronously.
- Opening chats/topics should reuse prefetched latest pages when available and start a background freshness fetch. If cache is missing, only the right-side panel should show loading; the async result must be ignored if the user has already backed away or opened another thread.
- Phone packaged WebView `localStorage` is not reliable across reopen/update even when simulator browser storage works. Use the Even Hub SDK app-side local storage for durable phone settings, and update the React settings draft after asynchronous restore so the phone UI does not show stale empty fields.
- On-device scroll events can arrive faster than page rebuilds complete. Do not await or trigger full glasses rebuilds for plain list selection movement, and keep same-direction swipe debounce narrow enough to filter duplicates without dropping intentional repeated swipes.
- The real G2 hardware path can be much slower than simulator if every input runs through expensive SDK normalization or debug logging. Keep input mapping synchronous work minimal, use raw payload parsing first, and make debug telemetry best-effort/throttled.
- `setState()` must not start native page rebuilds synchronously from input handling. Even when render promises are not awaited, calling `bridge.render()` inline can still build containers and enter the native bridge before the event callback returns, making all clicks/swipes feel delayed on real hardware.
- Avoid full-screen loading states for chat/topic open and message pagination during normal navigation. Keep the current UI navigable, show loading only in the right-side panel/status area, and ignore stale async results if the user has already swiped/backed away.
- Deferring `bridge.render()` is not enough if `setState()` still builds `screenModel(state)` or notifies React synchronously. Message page formatting and phone WebView rerenders share the same JS thread as glasses input events, so both must be deferred/coalesced.
- A text-rendered sidebar cannot move natively. When chat/topic selection has focus, use a real `ListContainerProperty` with event capture; reserve text-rendered sidebars for panel-focus pages where the user scrolls messages instead of the left list.
- Background Telegram work must not run during active glasses input. Treat polling, SSE decrypt/parse, topic previews, read acknowledgements, and speculative prefetches as noncritical; delay them briefly after any click/swipe so the phone WebView JS thread stays available for input handling.
- Automated frontend tests need explicit native-list invariants, not only controller state transitions. Regressions to catch include no-render-on-selection movement, no-render-on-no-op background refresh, item-name-only native click payloads, and simulator-visible unsupported glyph warnings.
- Simulator testing can validate startup rendering, click/scroll event mapping, and LVGL warnings, but it does not reproduce every phone/glasses hardware delay. Use simulator screenshots/logs as a required smoke check and still package/test on real G2 for input latency.
- Simulator automation can perturb its own latency if the harness polls console or captures webview screenshots too aggressively. Keep polling/frame capture lightweight, filter shadow-timer/audio console spam, and treat generated `latency.json` as invalid if the harness is flooding the automation server.
- WebCrypto PBKDF2 key derivation is expensive on phone hardware. Cache the derived AES key per backend shared secret while still generating fresh encrypted auth nonces for every request to satisfy backend replay protection.
- For device testing, the backend is not packaged into `.ehpk`. The `.ehpk` contains the frontend and manifest; the FastAPI backend must stay running and reachable from the phone/glasses path.
- Tailscale is a practical local device-test route, but the phone running the Even Realities app must be able to reach the Tailscale backend URL in `app.json` and the frontend's configured backend URL.
- Simulator microphone input can produce silent/all-zero audio. Guarding that path avoids unnecessary Whisper calls and confusing transcription errors during simulator validation.
- Frontend-local Telegram sessions and the backend shared secret improve backend disk privacy but are still sensitive. LocalStorage can be read by anyone with device/browser access, malicious extensions, or injected JavaScript. Do not mirror these values into cookies because cookies are sent to the frontend origin on requests.
- Debug endpoints and local STT are useful but sensitive. Raw hardware event logs can include gesture/message context and local Whisper can consume meaningful compute, so both should require backend shared-secret auth on the main backend.

- Telethon sessions can expire (logged out elsewhere, auth key revoked) without the service being explicitly disconnected. `AuthKeyUnregisteredError` and `AuthKeyDuplicatedError` must be caught and converted to a distinct `TelegramSessionExpiredError` that the API layer returns as 401, not 400. The Telethon logger must be filtered to suppress background `GetDifferenceRequest` noise from dead sessions (`account is not logged in`). An `_expired` flag on the service provides fast-fail: once set, `_get_client()` raises immediately without reconnecting. After first connect with a saved session string, a lightweight `get_me()` call validates the session before registering update handlers.
- Message display on the glasses benefits from a blank line between different messages for readability. Implemented as `gap` blocks in the `MessageDisplayBlock` pipeline: `messageDisplayBlocks` inserts empty `{ text: '', gap: true }` blocks between messages; `lineCount` treats gap blocks as 0 lines; `formatPage` trims leading/trailing gaps so page boundaries don't waste display space. The gap only separates different messages — a single long message split across multiple box blocks remains continuous.
- When no backend shared secret or Telegram API credentials are configured, `init()` must skip all API calls and go directly to the `needsSetup` auth screen with a friendly message. Calling `authStatus()` without credentials throws `Backend shared secret is required` which surfaces as a confusing error screen on first launch.

## Pending Checklist

- Validate `tele-glance-0.1.2.ehpk` on real G2 hardware to confirm the broader click-event mapper fixes chat/topic selection.
- If hardware clicks still fail, add a temporary debug screen or backend log endpoint that displays the raw last Even Hub event payload on the glasses/browser.
- Public setup docs now use `https://github.com/jalatif/even-g2-tele-glance.git`.
- Decide whether public distribution should keep frontend-local StringSession storage or move to encrypted per-user backend storage with real user authentication.
- Add real Telegram typing indicators. Message updates currently use server-sent events plus polling fallback.
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

## Validation Harness

Every screen the app can show is documented in `docs/UI_INVARIANTS.md` and validated by `scripts/simulator-flow.mjs`. The harness is the source of truth for "does this still work?"; manual smoke tests on real G2 hardware are a follow-up, not a replacement.

When adding a new screen or transition:
1. Add a screen block to `docs/UI_INVARIANTS.md` and the matching entry to `docs/UI_INVARIANTS.json`. The block must include `state`, `render`, `left` (for sidebar-kind screens), `right`, `transitions`, `budgetMs`, and any `apiCalls`/`bridgeCalls`/`eventMustEmit` expectations.
2. Add at least one step to the `steps` array in `UI_INVARIANTS.json` that exercises the new state.
3. Add the corresponding `logTeleGlanceTest` event in `web/src/testMode.ts` if you need a new event type.
4. If you add a new API call, wrap it in `InstrumentedTelegramApi` so the harness sees the latency.
5. Run `npm test --prefix web` to validate the catalog; run `npm run test:simulator --prefix web` to drive the simulator flow.

The harness enforces a 1 s latency budget on every state transition. If a step legitimately needs more time (e.g. `sidebarTranscribing` waiting on Whisper), update its `budgetMs` in the catalog and explain why.
The current set of issues the harness is flagging but not yet fixed lives in `docs/harness-test-failures.md` (13 distinct issues across app bugs, simulator limitations, and harness completeness). When a fix lands, update the issue's status and flip its `[ ] Fixed` checkbox; the next harness run must show the failure gone from the new artifact's `latency.json` before the fix is considered complete.