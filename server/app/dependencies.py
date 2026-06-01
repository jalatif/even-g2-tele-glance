from functools import lru_cache

from app.config import get_settings
from app.services.telegram import TelethonTelegramService, TelegramService
from app.services.transcription import WhisperTranscriptionService


@lru_cache
def get_telegram_service() -> TelegramService:
    return TelethonTelegramService(get_settings())


@lru_cache
def get_transcription_service() -> WhisperTranscriptionService:
    return WhisperTranscriptionService(get_settings())
