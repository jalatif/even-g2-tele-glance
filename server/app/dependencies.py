from functools import lru_cache
import hashlib
from typing import Annotated, Optional

from fastapi import Header, HTTPException

from app.config import get_settings
from app.services.secure_auth import SecureAuthError, decrypt_auth_header
from app.services.telegram import TelegramClientCredentials, TelethonTelegramService, TelegramService
from app.services.transcription import WhisperTranscriptionService


_telegram_services: dict[str, TelegramService] = {}


def get_telegram_service(
    x_teleglance_auth: Annotated[Optional[str], Header(alias="X-TeleGlance-Auth")] = None,
) -> TelegramService:
    settings = get_settings()
    credentials = telegram_credentials_from_encrypted_header(x_teleglance_auth, settings.teleglance_shared_secret)
    cache_key = telegram_service_cache_key(credentials)
    service = _telegram_services.get(cache_key)
    if service is None:
        service = TelethonTelegramService(settings, credentials)
        _telegram_services[cache_key] = service
    return service


def telegram_credentials_from_encrypted_header(
    encrypted_auth: Optional[str],
    shared_secret: Optional[str],
) -> Optional[TelegramClientCredentials]:
    if not shared_secret:
        raise HTTPException(status_code=400, detail="Backend shared secret is required. Set TELEGLANCE_SHARED_SECRET in backend .env and the same value in TeleGlance Settings.")
    if not encrypted_auth or not encrypted_auth.strip():
        raise HTTPException(status_code=400, detail="Encrypted auth is required. Fill Backend shared secret, Telegram API ID, and Telegram API hash in TeleGlance Settings.")
    try:
        payload = decrypt_auth_header(encrypted_auth.strip(), shared_secret)
    except SecureAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    api_id = str(payload.get("apiId") or "")
    api_hash = str(payload.get("apiHash") or "")
    session = str(payload.get("session") or "")

    api_id = (api_id or "").strip()
    api_hash = (api_hash or "").strip()
    session = (session or "").strip()
    if not api_id and not api_hash and not session:
        return None
    try:
        parsed_api_id = int(api_id)
    except ValueError:
        parsed_api_id = None
    return TelegramClientCredentials(
        api_id=parsed_api_id,
        api_hash=api_hash or None,
        session_string=session or None,
    )


def require_backend_auth(
    x_teleglance_auth: Annotated[Optional[str], Header(alias="X-TeleGlance-Auth")] = None,
) -> None:
    settings = get_settings()
    validate_backend_auth(x_teleglance_auth, settings.teleglance_shared_secret)


def validate_backend_auth(encrypted_auth: Optional[str], shared_secret: Optional[str]) -> None:
    if not shared_secret:
        raise HTTPException(status_code=400, detail="Backend shared secret is required. Set TELEGLANCE_SHARED_SECRET in backend .env and the same value in TeleGlance Settings.")
    if not encrypted_auth or not encrypted_auth.strip():
        raise HTTPException(status_code=400, detail="Encrypted auth is required.")
    try:
        decrypt_auth_header(encrypted_auth.strip(), shared_secret)
    except SecureAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def telegram_service_cache_key(credentials: Optional[TelegramClientCredentials]) -> str:
    if credentials is None:
        return "env"
    value = f"{credentials.api_id or ''}:{credentials.api_hash or ''}:{credentials.session_string or 'pending'}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@lru_cache
def get_transcription_service() -> WhisperTranscriptionService:
    return WhisperTranscriptionService(get_settings())
