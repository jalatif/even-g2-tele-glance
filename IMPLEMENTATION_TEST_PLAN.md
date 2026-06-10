# Implementation Testing Plan

## Static Checks

- Backend import check: `python3 -m compileall server tests/backend`
- Backend unit tests: `python3 -m pytest tests/backend`
- Frontend typecheck: `npm run typecheck --prefix web`
- Frontend unit tests: `npm test --prefix web`
- Frontend build: `npm run build --prefix web`

## Backend Scenarios

- Encrypted `GET /api/session/status` returns unauthenticated without a saved session.
- Encrypted phone-code login request bodies decrypt before FastAPI validation and encrypted responses decrypt on the frontend.
- Mismatched shared secrets fail closed without exposing Telegram credentials/session.
- Telegram dialog entities normalize into stable chat DTOs.
- Forum topics normalize into stable topic DTOs.
- History pagination preserves `before_id`, `limit`, and topic filters.
- Send message chooses normal chat send vs. topic reply metadata.
- WAV wrapping accepts signed 16-bit PCM and rejects empty audio.
- Transcription boundary is mockable and does not require Whisper in unit tests.

## Frontend Scenarios

- Startup renders auth/loading state before chats are available.
- Phone-code login is the only login path; QR login UI/API must not reappear.
- Chat list loads last five threads and handles empty/error states.
- Selecting a chat with topics opens topic selection.
- Selecting a chat without topics opens messages directly.
- Native list selection movement and no-op background refreshes do not repaint the active list, so the hardware highlight cannot snap back to the first item.
- Native list press/select events resolve both selected indexes and selected item names, including unread-count suffix handling.
- Startup prefetch warms the first visible chats/topics without blocking input, and cached opens render immediately while freshness fetches continue in the background.
- Message screen keeps a latest-message pointer, prefetches older history, and paginates long messages as complete chunks.
- Long message pages render with native Even Hub text-container borders on glasses instead of text-drawn boxes, because the G2 renderer is not a true monospace grid.
- Single press starts recording; second single press stops and transcribes.
- Confirmation screen exposes selectable `Send` and `Cancel`.
- Swipe changes confirmation selection; single press executes highlighted action.
- Double press backs out of message/topic screens.

## Simulator Validation

- Comprehensive invariant catalog: see `docs/UI_INVARIANTS.md` (human-readable) and `docs/UI_INVARIANTS.json` (machine-readable, consumed by the harness).
- Automated fixture flow: `npm run test:simulator --prefix web`.
- State/content-focused fixture flow: `node scripts/simulator-flow.mjs --fast --skip-latency-check`.
- Golden update flow: `npm run test:simulator --prefix web -- --update-goldens`.
- Current simulator investigation and remaining harness gaps: `validate_prompt_fixes.md`.
- The automated flow starts Vite with `VITE_TELEGLANCE_FIXTURE=1`, launches `@evenrealities/evenhub-simulator@0.7.2` with `--automation-port`, drives glasses inputs, writes `artifacts/simulator-flow/<timestamp>/report.md`, `latency.json`, `console.json`, `fixture.json`, step screenshots, and `flow.mp4`.
- The flow covers every state in `UI_INVARIANTS.md`: loading, auth, sidebar.chats, sidebar.topics (no preview, preview), sidebar.messages (normal, topic, loading), sidebarRecording, sidebarTranscribing, sidebarConfirm (send, cancel), sidebarSending, sidebarSent, asleep, newMessage, error. A 39th step (`39-perf-budget-chat-list`) intentionally exceeds the 1 s chat-load budget to prove the harness enforces it.
- Each step asserts (a) the expected controller state, (b) the expected screen model content (`renderBodyContains` checks for both left and right side), (c) the expected API calls with the right arguments, (d) the expected bridge calls, (e) the 1 s latency budget.
- The harness fails any step whose glasses screenshot is blank (only border-green pixels). When the simulator's `/api/screenshot/glasses` returns empty pixels, the harness falls back to the webview screenshot for content checks and emits a clear warning.
- The saved glasses-frame goldens live in `web/test/simulator-goldens/*.glasses.png`; update them only after manually inspecting the generated report/video.
- Detailed learnings from the most recent harness run, including per-step pass/fail status, performance budgets, and confirmed-broken behaviors, live in `docs/HARNESS_LEARNINGS.md`.
- Manual fallback:
  - Start backend on `http://localhost:8787`.
  - Start Vite frontend on `http://localhost:5173`.
  - Run Even Hub simulator against the frontend URL.
- Validate all primary screens fit the 576x288 viewport:
  - Auth/setup
  - Chat list
  - Topic list
  - Message history
  - Recording
  - Send/cancel confirmation
  - Error/retry
- Verify simulator input events map to app transitions.
- Drive simulator click/scroll flows on chat and topic lists, then confirm the glasses pane remains consistent with the selected row and does not briefly duplicate the left list in the right pane.
- Watch simulator logs for LVGL unsupported-glyph warnings while rendering message text; add sanitization regressions for any glyph class that appears.
- Verify the display is nonblank and text does not overflow critical controls.

## Hardware Validation

- Use `npm run configure:tailscale --prefix web` before opening the app from phone/glasses.
- Confirm TeleGlance Settings has `Backend URL=http://<tailscale-ip>:8787`.
- Confirm TeleGlance Settings has `Backend shared secret` matching root `.env` `TELEGLANCE_SHARED_SECRET`.
- Confirm `app.json` network whitelist includes `http://<tailscale-ip>:8787`.
- Sideload the local frontend through Even Hub.
- Confirm the phone can reach the local backend over LAN.
- Verify microphone permission prompt and `g2-microphone` permission behavior.
- Validate recording, transcription, send confirmation, and cancellation on real G2 hardware.
- Validate root-screen double-click asleep/wake behavior and incoming-message notification jump-to-thread behavior on real G2 hardware.
- Validate long-message bordered display in the glasses pane, not just the browser/debug pane.
