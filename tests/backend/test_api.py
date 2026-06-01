from datetime import datetime, timezone

import httpx
import pytest

from app.dependencies import get_telegram_service, get_transcription_service
from app.main import create_app
from app.models import (
    ChatSummary,
    MessageSummary,
    QrLoginStart,
    SendMessageResponse,
    TopicSummary,
    TranscriptionResponse,
)


class FakeTelegramService:
    def __init__(self):
        self.sent = []
        self.message_calls = []

    async def auth_status(self):
        return {"configured": False, "authorized": False, "qr_login_available": True}

    async def start_qr_login(self):
        return QrLoginStart(token="abcd", url="tg://login?token=abcd", expires_at=None)

    async def qr_login_status(self):
        return {"authorized": False, "expired": False, "message": None}

    async def current_qr_login_url(self):
        return "tg://login?token=abcd"

    async def list_chats(self, limit):
        return [
            ChatSummary(id=1, title="Ada", kind="user", last_message="hello"),
            ChatSummary(id=2, title="Project", kind="group", is_forum=True),
        ][:limit]

    async def list_topics(self, chat_id):
        assert chat_id == 2
        return [TopicSummary(id=11, title="Build", top_message_id=101, unread_count=2)]

    async def list_messages(self, chat_id, *, topic_id=None, before_id=None, limit=8):
        self.message_calls.append(
            {"chat_id": chat_id, "topic_id": topic_id, "before_id": before_id, "limit": limit}
        )
        return [
            MessageSummary(
                id=8,
                sender="Ada",
                text="Latest",
                sent_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        ]

    async def send_message(self, chat_id, *, text, topic_id=None):
        self.sent.append({"chat_id": chat_id, "text": text, "topic_id": topic_id})
        return SendMessageResponse(id=55)


class FakeTranscriptionService:
    def __init__(self):
        self.payloads = []

    async def transcribe_wav(self, wav_bytes):
        self.payloads.append(wav_bytes)
        return TranscriptionResponse(text="send the update", language="en", duration_seconds=0.5)


@pytest.fixture
def fake_services():
    return FakeTelegramService(), FakeTranscriptionService()


@pytest.fixture
def app(fake_services):
    telegram, transcription = fake_services
    app = create_app()
    app.dependency_overrides[get_telegram_service] = lambda: telegram
    app.dependency_overrides[get_transcription_service] = lambda: transcription
    return app


@pytest.mark.asyncio
async def test_auth_status_without_session(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "authorized": False,
        "qrLoginAvailable": True,
    }


@pytest.mark.asyncio
async def test_chat_topic_and_message_endpoints(app, fake_services):
    telegram, _ = fake_services
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        chats = await client.get("/api/chats?limit=5")
        topics = await client.get("/api/chats/2/topics")
        messages = await client.get("/api/chats/2/messages?topic_id=101&before_id=99&limit=3")

    assert chats.status_code == 200
    assert chats.json()[1]["isForum"] is True
    assert topics.json() == [{"id": 11, "title": "Build", "topMessageId": 101, "unreadCount": 2}]
    assert messages.json()[0]["text"] == "Latest"
    assert telegram.message_calls == [
        {"chat_id": 2, "topic_id": 101, "before_id": 99, "limit": 3}
    ]


@pytest.mark.asyncio
async def test_qr_login_status_endpoint(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/qr/status")

    assert response.status_code == 200
    assert response.json() == {"authorized": False, "expired": False, "message": None}


@pytest.mark.asyncio
async def test_qr_login_image_endpoint(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/qr/image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_debug_events_accept_null_mapped_input(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/debug/events",
            json={"source": "even-hub", "buildVersion": "test", "raw": {"eventType": 0}, "mapped": None},
        )
        events = await client.get("/api/debug/events")

    assert response.status_code == 200
    assert response.json() == {"count": 1}
    assert events.json()[0]["mapped"] is None


@pytest.mark.asyncio
async def test_debug_events_skip_audio_chunks(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/debug/events",
            json={"source": "even-hub", "buildVersion": "test", "raw": {}, "mapped": {"type": "audioChunk"}},
        )
        events = await client.get("/api/debug/events")

    assert response.status_code == 200
    assert response.json() == {"count": 0}
    assert events.json() == []


@pytest.mark.asyncio
async def test_send_payload_generation_for_normal_and_topic_chats(app, fake_services):
    telegram, _ = fake_services
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        normal = await client.post("/api/chats/1/messages", json={"text": "hi"})
        topic = await client.post("/api/chats/2/messages", json={"text": "ship it", "topic_id": 101})

    assert normal.json() == {"id": 55, "status": "sent"}
    assert topic.json() == {"id": 55, "status": "sent"}
    assert telegram.sent == [
        {"chat_id": 1, "text": "hi", "topic_id": None},
        {"chat_id": 2, "text": "ship it", "topic_id": 101},
    ]


@pytest.mark.asyncio
async def test_transcribe_wraps_pcm_upload_as_wav(app, fake_services):
    _, transcription = fake_services
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/transcribe",
            files={"audio": ("sample.pcm", b"\x00\x00\xff\x7f", "audio/pcm")},
        )

    assert response.status_code == 200
    assert response.json()["text"] == "send the update"
    assert transcription.payloads[0].startswith(b"RIFF")
