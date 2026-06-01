# Implementation Testing Plan

## Static Checks

- Backend import check: `python3 -m compileall server tests/backend`
- Backend unit tests: `python3 -m pytest tests/backend`
- Frontend typecheck: `npm run typecheck --prefix web`
- Frontend unit tests: `npm test --prefix web`
- Frontend build: `npm run build --prefix web`

## Backend Scenarios

- Auth status returns unauthenticated without a saved session.
- Telegram dialog entities normalize into stable chat DTOs.
- Forum topics normalize into stable topic DTOs.
- History pagination preserves `before_id`, `limit`, and topic filters.
- Send message chooses normal chat send vs. topic reply metadata.
- WAV wrapping accepts signed 16-bit PCM and rejects empty audio.
- Transcription boundary is mockable and does not require Whisper in unit tests.

## Frontend Scenarios

- Startup renders auth/loading state before chats are available.
- Chat list loads last five threads and handles empty/error states.
- Selecting a chat with topics opens topic selection.
- Selecting a chat without topics opens messages directly.
- Message screen paginates older messages.
- Single press starts recording; second single press stops and transcribes.
- Confirmation screen exposes selectable `Send` and `Cancel`.
- Swipe changes confirmation selection; single press executes highlighted action.
- Double press backs out of message/topic screens.

## Simulator Validation

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
- Verify the display is nonblank and text does not overflow critical controls.

## Hardware Validation

- Use `npm run configure:tailscale --prefix web` before opening the app from phone/glasses.
- Confirm `web/.env.local` has `VITE_API_BASE_URL=http://<tailscale-ip>:8787`.
- Confirm `app.json` network whitelist includes `http://<tailscale-ip>:8787`.
- QR/sideload the local frontend through Even Hub.
- Confirm the phone can reach the local backend over LAN.
- Verify microphone permission prompt and `g2-microphone` permission behavior.
- Validate recording, transcription, send confirmation, and cancellation on real G2 hardware.
