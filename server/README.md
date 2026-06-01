# Even Telegram Backend

FastAPI backend for the Even G2 Telegram app. It owns Telegram MTProto credentials,
the Telethon session file, and local Whisper transcription so the glasses frontend
only talks to normalized local API endpoints.

## Setup

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
```

Fill in `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from Telegram's developer portal.
The default Telethon session path is `server/data/telegram.session`.

## Run

```bash
../scripts/start-backend.sh --reload
```

The launcher always uses `server/.venv/bin/python -m uvicorn`. Avoid running
plain `uvicorn`; it can come from another virtualenv and then fail to import
Telethon or Whisper dependencies.

## Error Handling

Telegram network calls are wrapped with bounded timeouts. Transient Telethon
timeouts are returned as `504 Gateway Timeout` with retryable copy instead of
`400 Bad Request`, because they usually mean Telegram or the local network was
slow rather than the frontend sent an invalid request.

The `/api/updates` endpoint streams Telegram message updates as server-sent
events. Clients should treat stream errors as recoverable and fall back to
normal refresh/poll behavior.

## Test

```bash
PYTHONPYCACHEPREFIX=../.pycache .venv/bin/python -m pytest ../tests/backend
```

Tests use fake Telegram and Whisper services; they do not need credentials, network
access, or a local Whisper model.
