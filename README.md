# Even Telegram

Even G2 glasses app for browsing recent Telegram chats/topics, reading message history, and sending short text replies from voice transcription.

The implementation follows the project plan in [AGENTS.md](AGENTS.md).

## Architecture

- `web/`: Even Hub frontend for the 576x288 glasses UI.
- `server/`: Local FastAPI backend for Telegram MTProto access and local Whisper transcription.
- `tests/`: Focused unit tests for backend normalization and frontend state transitions.

## Local Development

Backend:

```sh
cd server
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8787
```

Frontend:

```sh
cd web
npm install
npm run dev
```

For real phone/glasses testing, the frontend must call the Mac over a reachable IP, not `localhost` on the phone/glasses. Tailscale is enabled by default for local device testing:

```sh
cd web
npm run configure:tailscale
npm run dev:tailscale
```

`configure:tailscale` detects `tailscale ip -4`, writes `web/.env.local`, and adds the backend origin to `app.json` network whitelist. The backend accepts Tailscale dev origins by default when `TAILSCALE_ENABLED=true`.

Even Hub simulator validation:

```sh
npx @evenrealities/evenhub-simulator@0.7.2 http://localhost:5173
```

Hardware package build:

```sh
npm run build:tailscale --prefix web
npx --yes @evenrealities/evenhub-cli pack app.json web/dist -o even-telegram-<version>.ehpk
```

Hardware-specific implementation notes are maintained in [EVEN_REALITIES_HW.md](EVEN_REALITIES_HW.md). In particular, the G2 glasses display does not render text as a true monospace grid, so long-message blocks use native `TextContainerProperty` borders instead of text-drawn rectangles.

## Required Environment

Create `server/.env` from `server/.env.example` and set:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- `WHISPER_BEAM_SIZE`
- `WHISPER_BEST_OF`
- `WHISPER_TEMPERATURE`
- `WHISPER_CONDITION_ON_PREVIOUS_TEXT`

Telegram session files are stored under `server/data/` and ignored by Git.
