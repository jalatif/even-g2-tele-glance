# TeleGlance Backend

FastAPI backend for TeleGlance. In the public self-hosted flow, Telegram API credentials and the Telegram StringSession are supplied by the frontend inside encrypted `X-TeleGlance-Auth`; the backend does not need to store them on disk.

The backend owns normalized API endpoints, Telegram MTProto calls, and local Whisper transcription.

## Setup

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

The backend reads the root `.env` for `TELEGLANCE_SHARED_SECRET`. The same value must be entered in TeleGlance Settings. Other settings are optional unless you are tuning CORS or Whisper. Telegram credentials, Backend URL, and STT URL are configured in the frontend Settings page.

`TAILSCALE_ENABLED` defaults to `true`, which allows browser origins from Tailscale `100.64.0.0/10` addresses. If you are not using Tailscale, set `TAILSCALE_ENABLED=false` in root `.env` and use the machine's LAN IP in TeleGlance Settings. The launcher binds the backend to `0.0.0.0:8787`, not localhost-only.

## Speech-To-Text

The backend exposes `POST /api/transcribe` for voice replies. The endpoint accepts WAV audio, or raw 16 kHz signed PCM as `audio/pcm`/`application/octet-stream`, and returns JSON like:

```json
{ "text": "message to send" }
```

Optional Whisper tuning lives in the root `.env`; defaults are `base`, `auto`, and `int8`:

- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- advanced optional: `WHISPER_BEAM_SIZE`, `WHISPER_BEST_OF`, `WHISPER_TEMPERATURE`, `WHISPER_CONDITION_ON_PREVIOUS_TEXT`

The frontend can optionally point STT at another server, but that server must implement the same `/api/transcribe` contract.

## Required Encrypted App Payloads

Set `TELEGLANCE_SHARED_SECRET` in the root `.env` and enter the same value in TeleGlance Settings. The frontend encrypts Telegram API ID/hash/session into `X-TeleGlance-Auth`, encrypts JSON request bodies, and decrypts encrypted JSON responses and update events. The secret itself is never sent over the wire.

This reduces passive credential/message sniffing risk over HTTP, but it is not a full HTTPS replacement. A malicious network can still block or tamper with traffic. Use Tailscale or HTTPS when possible.

## Run

```bash
scripts/start-backend.sh --reload
```

The launcher always uses `server/.venv/bin/python -m uvicorn`. Avoid running plain `uvicorn`; it can come from another virtualenv and fail to import Telethon or Whisper dependencies.

## Credential Flow

Frontend requests include encrypted app auth only:

- `X-TeleGlance-Auth`

`X-TeleGlance-Auth` contains the Telegram API ID/hash and Telegram StringSession encrypted with `TELEGLANCE_SHARED_SECRET`. There are no plaintext Telegram credential headers or compatibility auth endpoints.

Phone-code login is the supported login path:

- `GET /api/session/status` checks the encrypted Telegram session state.
- `POST /api/session/phone/start` with a mobile number in international format sends the Telegram verification code.
- `POST /api/session/phone/verify` with the same number and code completes login and returns `sessionString` in an encrypted response.
- `POST /api/session/logout` disconnects the current encrypted session.

Telegram accounts with two-step verification still need password-login support before phone-code login can complete.

## Error Handling

Telegram network calls are wrapped with bounded timeouts. Transient Telethon timeouts are returned as `504 Gateway Timeout` with retryable copy instead of `400 Bad Request`.

The `/api/updates` endpoint streams Telegram message updates as server-sent events. The frontend uses `fetch` streaming so encrypted app auth can remain in headers instead of query parameters.

## Test

```bash
PYTHONPYCACHEPREFIX=.pycache server/.venv/bin/python -m pytest tests/backend
```

Tests use fake Telegram and Whisper services; they do not need credentials, network access, or a local Whisper model.
