from collections import deque
from datetime import datetime, timezone
from io import BytesIO
import json
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.dependencies import get_telegram_service, get_transcription_service
from app.models import (
    AuthStatus,
    ChatSummary,
    DebugEvent,
    MessageSummary,
    QrLoginStart,
    QrLoginStatus,
    SendMessageRequest,
    SendMessageResponse,
    TopicSummary,
    TelegramUpdate,
    TranscriptionResponse,
)
from app.services.audio import pcm16le_to_wav
from app.services.telegram import TelegramService, TelegramServiceError, TelegramServiceTimeoutError
from app.services.transcription import TranscriptionServiceError, WhisperTranscriptionService


def raise_telegram_http_error(exc: Exception) -> None:
    if isinstance(exc, (TelegramServiceTimeoutError, TimeoutError)):
        raise HTTPException(status_code=504, detail=str(exc) or "Telegram request timed out. Please retry.") from exc
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    app_settings = settings or get_settings()
    api = FastAPI(title="G2 Tele Backend")
    debug_events: deque[dict] = deque(maxlen=100)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.backend_cors_origins,
        allow_origin_regex=app_settings.backend_cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @api.post("/api/debug/events")
    async def append_debug_event(payload: DebugEvent) -> dict[str, int]:
        event = payload.model_dump(mode="json")
        mapped = event.get("mapped") or {}
        if mapped.get("type") == "audioChunk":
            return {"count": len(debug_events)}
        event["received_at"] = datetime.now(timezone.utc).isoformat()
        debug_events.append(event)
        return {"count": len(debug_events)}

    @api.get("/api/debug/events")
    async def list_debug_events() -> list[dict]:
        return list(debug_events)

    @api.delete("/api/debug/events")
    async def clear_debug_events() -> dict[str, int]:
        debug_events.clear()
        return {"count": 0}

    @api.get("/api/auth/status", response_model=AuthStatus)
    async def auth_status(
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> AuthStatus:
        try:
            return AuthStatus(**await telegram.auth_status())
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.post("/api/auth/qr/start", response_model=QrLoginStart)
    async def start_qr_login(
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> QrLoginStart:
        try:
            return await telegram.start_qr_login()
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/auth/qr/status", response_model=QrLoginStatus)
    async def qr_login_status(
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> QrLoginStatus:
        try:
            return await telegram.qr_login_status()
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/auth/qr/image")
    async def qr_login_image(
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> StreamingResponse:
        try:
            url = await telegram.current_qr_login_url()
            import qrcode

            image = qrcode.make(url)
            output = BytesIO()
            image.save(output, format="PNG")
            output.seek(0)
            return StreamingResponse(
                output,
                media_type="image/png",
                headers={"Cache-Control": "no-store, max-age=0"},
            )
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/chats", response_model=list[ChatSummary])
    async def list_chats(
        limit: int = Query(default=5, ge=1, le=20),
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> list[ChatSummary]:
        try:
            return await telegram.list_chats(limit=limit)
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/chats/{chat_id}/topics", response_model=list[TopicSummary])
    async def list_topics(
        chat_id: int,
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> list[TopicSummary]:
        try:
            return await telegram.list_topics(chat_id)
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/chats/{chat_id}/messages", response_model=list[MessageSummary])
    async def list_messages(
        chat_id: int,
        topic_id: Optional[int] = None,
        before_id: Optional[int] = None,
        limit: int = Query(default=8, ge=1, le=50),
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> list[MessageSummary]:
        try:
            return await telegram.list_messages(
                chat_id,
                topic_id=topic_id,
                before_id=before_id,
                limit=limit,
            )
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.get("/api/updates")
    async def stream_updates(
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> StreamingResponse:
        async def events():
            try:
                async for update in telegram.update_events():
                    payload = update.model_dump_json(by_alias=True)
                    yield f"event: message\ndata: {payload}\n\n"
            except TelegramServiceError as exc:
                payload = json.dumps({"detail": str(exc)})
                yield f"event: error\ndata: {payload}\n\n"

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "Connection": "keep-alive",
            },
        )

    @api.post("/api/chats/{chat_id}/messages", response_model=SendMessageResponse)
    async def send_message(
        chat_id: int,
        payload: SendMessageRequest,
        telegram: TelegramService = Depends(get_telegram_service),
    ) -> SendMessageResponse:
        try:
            return await telegram.send_message(chat_id, text=payload.text, topic_id=payload.topic_id)
        except (TelegramServiceError, TimeoutError) as exc:
            raise_telegram_http_error(exc)

    @api.post("/api/transcribe", response_model=TranscriptionResponse)
    async def transcribe(
        audio: UploadFile = File(...),
        transcription: WhisperTranscriptionService = Depends(get_transcription_service),
    ) -> TranscriptionResponse:
        raw = await audio.read()
        try:
            if audio.content_type in {"audio/pcm", "application/octet-stream"}:
                raw = pcm16le_to_wav(raw)
            return await transcription.transcribe_wav(raw)
        except (ValueError, TranscriptionServiceError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return api


app = create_app()
