import json
import time

import httpx
import pytest
from fastapi import HTTPException

from app.dependencies import get_telegram_service, telegram_credentials_from_encrypted_header
from app.main import create_app
from app.config import Settings
from app.models import PhoneLoginStart
from app.services.secure_auth import decrypt_payload, encrypt_payload


def test_encrypted_payload_round_trip():
    encrypted = encrypt_payload(b'{"hello":"world"}', "shared-secret")

    assert decrypt_payload(encrypted, "shared-secret") == b'{"hello":"world"}'


def test_telegram_credentials_require_encrypted_auth():
    with pytest.raises(HTTPException) as missing_secret:
        telegram_credentials_from_encrypted_header(None, None)
    assert missing_secret.value.status_code == 400

    with pytest.raises(HTTPException) as missing_auth:
        telegram_credentials_from_encrypted_header(None, "shared-secret")
    assert missing_auth.value.status_code == 400


def test_telegram_credentials_decrypt_encrypted_auth():
    payload = {
        "apiId": "12345",
        "apiHash": "abc",
        "session": "session-string",
        "ts": int(time.time()),
    }
    encrypted_auth = encrypt_payload(json.dumps(payload).encode("utf-8"), "shared-secret")

    credentials = telegram_credentials_from_encrypted_header(encrypted_auth, "shared-secret")

    assert credentials is not None
    assert credentials.api_id == 12345
    assert credentials.api_hash == "abc"
    assert credentials.session_string == "session-string"


@pytest.mark.asyncio
async def test_encrypted_json_request_body_is_decrypted_before_validation():
    app = create_app(Settings(TELEGLANCE_SHARED_SECRET="shared-secret", BACKEND_CORS_ORIGINS=[]))
    seen_phone = {}

    class PhoneLoginService:
        async def start_phone_login(self, phone):
            seen_phone["value"] = phone
            return PhoneLoginStart(phone=phone, sent=True, message="Verification code sent.")

    app.dependency_overrides[get_telegram_service] = lambda: PhoneLoginService()
    encrypted_auth = encrypt_payload(json.dumps({
        "apiId": "12345",
        "apiHash": "abc",
        "session": "",
        "ts": int(time.time()),
    }).encode("utf-8"), "shared-secret")
    encrypted_body = encrypt_payload(b'{"phone":"+14155552671"}', "shared-secret")
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/session/phone/start",
            headers={
                "Content-Type": "application/json",
                "X-TeleGlance-Auth": encrypted_auth,
            },
            json={"encryptedPayload": encrypted_body},
        )

    assert response.status_code == 200
    assert response.headers["X-TeleGlance-Encrypted"] == "1"
    decrypted = decrypt_payload(response.json()["encryptedPayload"], "shared-secret")
    assert json.loads(decrypted) == {
        "phone": "+14155552671",
        "sent": True,
        "message": "Verification code sent.",
    }
    assert seen_phone == {"value": "+14155552671"}
