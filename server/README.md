# Even Telegram Backend

FastAPI backend for the Even G2 Telegram app. It owns Telegram MTProto credentials,
the Telethon session file, and local Whisper transcription so the glasses frontend
only talks to normalized local API endpoints.

## Setup

```bash
cd server
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
```

Fill in `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from Telegram's developer portal.
The default Telethon session path is `server/data/telegram.session`.

## Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

## Test

```bash
python -m pytest ../tests/backend
```

Tests use fake Telegram and Whisper services; they do not need credentials, network
access, or a local Whisper model.
