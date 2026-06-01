import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional, Protocol

from app.config import Settings
from app.models import ChatSummary, MessageSummary, QrLoginStart, QrLoginStatus, SendMessageResponse, TelegramUpdate, TopicSummary


class TelegramServiceError(RuntimeError):
    pass


class TelegramServiceTimeoutError(TelegramServiceError):
    pass


def wrap_telegram_error(exc: Exception) -> TelegramServiceError:
    if isinstance(exc, TimeoutError):
        return TelegramServiceTimeoutError("Telegram request timed out. Please retry.")
    return TelegramServiceError(str(exc) or exc.__class__.__name__)


class TelegramService(Protocol):
    async def auth_status(self) -> dict[str, bool]:
        ...

    async def start_qr_login(self) -> QrLoginStart:
        ...

    async def qr_login_status(self) -> QrLoginStatus:
        ...

    async def current_qr_login_url(self) -> str:
        ...

    async def list_chats(self, limit: int) -> list[ChatSummary]:
        ...

    async def list_topics(self, chat_id: int) -> list[TopicSummary]:
        ...

    async def list_messages(
        self,
        chat_id: int,
        *,
        topic_id: Optional[int] = None,
        before_id: Optional[int] = None,
        limit: int = 8,
    ) -> list[MessageSummary]:
        ...

    async def send_message(
        self,
        chat_id: int,
        *,
        text: str,
        topic_id: Optional[int] = None,
    ) -> SendMessageResponse:
        ...

    def update_events(self) -> AsyncIterator[TelegramUpdate]:
        ...


def _display_name(entity: Any) -> str:
    title = getattr(entity, "title", None)
    if title:
        return str(title)
    first_name = getattr(entity, "first_name", "") or ""
    last_name = getattr(entity, "last_name", "") or ""
    name = f"{first_name} {last_name}".strip()
    username = getattr(entity, "username", None)
    return name or (f"@{username}" if username else "Unknown")


def normalize_dialog(dialog: Any) -> ChatSummary:
    entity = getattr(dialog, "entity", dialog)
    dialog_id = getattr(dialog, "id", getattr(entity, "id"))
    has_title = bool(getattr(entity, "title", None))
    has_user_name = bool(
        getattr(entity, "first_name", None)
        or getattr(entity, "last_name", None)
        or getattr(entity, "username", None)
    )
    is_user = bool(not has_title and getattr(entity, "bot", False) is False and has_user_name)
    is_channel = bool(getattr(entity, "broadcast", False))
    kind = "user" if is_user else "channel" if is_channel else "group"
    message = getattr(dialog, "message", None)
    last_message = getattr(message, "message", None) if message else None
    return ChatSummary(
        id=int(dialog_id),
        title=_display_name(entity),
        kind=kind,
        unread_count=int(getattr(dialog, "unread_count", 0) or 0),
        is_forum=bool(getattr(entity, "forum", False)),
        last_message=last_message or None,
    )


def normalize_topic(topic: Any) -> TopicSummary:
    return TopicSummary(
        id=int(getattr(topic, "id")),
        title=str(getattr(topic, "title", "Untitled")),
        top_message_id=int(getattr(topic, "top_message", getattr(topic, "top_message_id", 0))),
        unread_count=int(getattr(topic, "unread_count", 0) or 0),
    )


def normalize_message(message: Any, entities_by_peer: Optional[dict[int, Any]] = None) -> MessageSummary:
    sender = getattr(message, "sender", None)
    if sender is None and entities_by_peer:
        sender = entities_by_peer.get(_message_peer_key(message))
    sender_name = _display_name(sender) if sender is not None else None
    return MessageSummary(
        id=int(getattr(message, "id")),
        sender=sender_name,
        text=str(getattr(message, "message", "") or ""),
        sent_at=getattr(message, "date", None),
        outgoing=bool(getattr(message, "out", False)),
    )


def normalize_update_message(message: Any, chat_id: Optional[int] = None) -> TelegramUpdate:
    return TelegramUpdate(
        chat_id=int(chat_id if chat_id is not None else getattr(message, "chat_id", 0)),
        topic_id=_message_topic_id(message),
        message=normalize_message(message),
    )


def _entity_lookup(entities: list[Any]) -> dict[int, Any]:
    lookup: dict[int, Any] = {}
    for entity in entities:
        for key in _entity_keys(entity):
            lookup[key] = entity
    return lookup


def _entity_keys(entity: Any) -> set[int]:
    keys: set[int] = set()
    entity_id = getattr(entity, "id", None)
    if entity_id is not None:
        keys.add(int(entity_id))
        if getattr(entity, "broadcast", False) or getattr(entity, "megagroup", False) or getattr(entity, "forum", False):
            keys.add(-1000000000000 - int(entity_id))
    try:
        from telethon import utils

        keys.add(int(utils.get_peer_id(entity)))
    except Exception:
        pass
    return keys


def _message_peer_key(message: Any) -> Optional[int]:
    peer = getattr(message, "from_id", None) or getattr(message, "peer_id", None)
    if peer is None:
        sender_id = getattr(message, "sender_id", None)
        return int(sender_id) if sender_id is not None else None
    for attr in ("user_id", "chat_id", "channel_id"):
        value = getattr(peer, attr, None)
        if value is not None:
            return int(value)
    try:
        from telethon import utils

        return int(utils.get_peer_id(peer))
    except Exception:
        return None


def _message_topic_id(message: Any) -> Optional[int]:
    reply_to = getattr(message, "reply_to", None)
    if reply_to is None:
        return None
    for attr in ("reply_to_top_id", "reply_to_msg_id", "forum_topic_id"):
        value = getattr(reply_to, attr, None)
        if value is not None:
            return int(value)
    return None


def qr_login_start_from_telethon(qr_login: Any) -> QrLoginStart:
    expires = normalize_expiry(getattr(qr_login, "expires", None))
    token = getattr(qr_login, "token", b"")
    if isinstance(token, bytes):
        token_value = token.hex()
    else:
        token_value = str(token)
    return QrLoginStart(
        token=token_value,
        url=str(getattr(qr_login, "url", "")),
        expires_at=expires,
    )


def normalize_expiry(expires: Any) -> Optional[datetime]:
    if isinstance(expires, datetime):
        return expires
    if isinstance(expires, (int, float)):
        return datetime.fromtimestamp(expires, tz=timezone.utc)
    return None


def is_expired(expires: Any) -> bool:
    expires_at = normalize_expiry(expires)
    if expires_at is None:
        return False
    now = datetime.now(expires_at.tzinfo or timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= now


@dataclass
class TelethonTelegramService:
    settings: Settings

    def __post_init__(self) -> None:
        self._client = None
        self._qr_login = None
        self._qr_login_task: Optional[asyncio.Task] = None
        self._update_queues: set[asyncio.Queue[TelegramUpdate]] = set()
        self._updates_registered = False

    @property
    def configured(self) -> bool:
        return bool(self.settings.telegram_api_id and self.settings.telegram_api_hash)

    async def _get_client(self):
        if not self.configured:
            raise TelegramServiceError("Telegram API credentials are not configured")
        if self._client is None:
            try:
                from telethon import TelegramClient
            except ImportError as exc:
                raise TelegramServiceError("Telethon is not installed. Install server requirements.") from exc

            self.settings.telegram_session_path.parent.mkdir(parents=True, exist_ok=True)
            self._client = TelegramClient(
                str(self.settings.telegram_session_path),
                self.settings.telegram_api_id,
                self.settings.telegram_api_hash,
            )
        if not self._client.is_connected():
            await self._client.connect()
        await self._ensure_update_handler()
        return self._client

    async def _ensure_update_handler(self) -> None:
        if self._updates_registered or self._client is None:
            return
        try:
            from telethon import events
        except ImportError as exc:
            raise TelegramServiceError("Telethon update API is unavailable") from exc

        self._client.add_event_handler(self._handle_new_message, events.NewMessage())
        self._updates_registered = True

    async def _handle_new_message(self, event: Any) -> None:
        if not self._update_queues:
            return
        message = getattr(event, "message", None)
        if message is None:
            return
        update = normalize_update_message(message, getattr(event, "chat_id", None))
        for queue in list(self._update_queues):
            try:
                queue.put_nowait(update)
            except asyncio.QueueFull:
                pass

    async def update_events(self) -> AsyncIterator[TelegramUpdate]:
        client = await self._get_client()
        if not await client.is_user_authorized():
            raise TelegramServiceError("Telegram session is not authorized")
        queue: asyncio.Queue[TelegramUpdate] = asyncio.Queue(maxsize=50)
        self._update_queues.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._update_queues.discard(queue)

    async def auth_status(self) -> dict[str, bool]:
        if not self.configured:
            return {"configured": False, "authorized": False, "qr_login_available": True}
        client = await self._get_client()
        return {
            "configured": True,
            "authorized": bool(await client.is_user_authorized()),
            "qr_login_available": True,
        }

    async def start_qr_login(self) -> QrLoginStart:
        client = await self._get_client()
        if await client.is_user_authorized():
            return QrLoginStart(token="", url="", expires_at=None)
        qr_login = await client.qr_login()
        self._qr_login = qr_login
        if self._qr_login_task and not self._qr_login_task.done():
            self._qr_login_task.cancel()
        self._qr_login_task = asyncio.create_task(self._wait_for_qr_login(qr_login))
        self._qr_login_task.add_done_callback(self._observe_qr_login_task)
        return qr_login_start_from_telethon(qr_login)

    async def qr_login_status(self) -> QrLoginStatus:
        if not self.configured:
            raise TelegramServiceError("Telegram API credentials are not configured")

        client = await self._get_client()
        if await client.is_user_authorized():
            self._clear_qr_login()
            return QrLoginStatus(authorized=True)

        if self._qr_login is None:
            return QrLoginStatus(
                authorized=False,
                expired=True,
                message="QR login has not been started.",
            )

        expires = getattr(self._qr_login, "expires", None)
        if is_expired(expires):
            self._clear_qr_login()
            return QrLoginStatus(authorized=False, expired=True, message="QR login expired.")

        if self._qr_login_task is None or not self._qr_login_task.done():
            return QrLoginStatus(authorized=False, expired=False)

        try:
            self._qr_login_task.result()
        except asyncio.CancelledError:
            return QrLoginStatus(authorized=False, expired=True, message="QR login was cancelled.")
        except Exception as exc:
            error_name = exc.__class__.__name__
            if error_name == "SessionPasswordNeededError":
                self._clear_qr_login()
                raise TelegramServiceError("Telegram account has two-step verification enabled; password login is not implemented yet.") from exc
            raise TelegramServiceError(str(exc)) from exc

        self._clear_qr_login()
        return QrLoginStatus(authorized=bool(await client.is_user_authorized()))

    async def current_qr_login_url(self) -> str:
        if self._qr_login is None:
            raise TelegramServiceError("QR login has not been started.")
        expires = getattr(self._qr_login, "expires", None)
        if is_expired(expires):
            self._clear_qr_login()
            raise TelegramServiceError("QR login expired.")
        return str(getattr(self._qr_login, "url", ""))

    async def _wait_for_qr_login(self, qr_login: Any) -> None:
        await qr_login.wait()

    def _observe_qr_login_task(self, task: asyncio.Task) -> None:
        if task.cancelled():
            return
        try:
            task.exception()
        except asyncio.CancelledError:
            return

    def _clear_qr_login(self) -> None:
        if self._qr_login_task and not self._qr_login_task.done():
            self._qr_login_task.cancel()
        self._qr_login_task = None
        self._qr_login = None

    async def list_chats(self, limit: int) -> list[ChatSummary]:
        client = await self._get_client()
        try:
            dialogs = await asyncio.wait_for(client.get_dialogs(limit=limit), timeout=20)
            return [normalize_dialog(dialog) for dialog in dialogs]
        except Exception as exc:
            raise wrap_telegram_error(exc) from exc

    async def list_topics(self, chat_id: int) -> list[TopicSummary]:
        client = await self._get_client()
        try:
            from telethon.tl.functions.messages import GetForumTopicsRequest
        except ImportError as exc:
            raise TelegramServiceError("Telethon forum topic API is unavailable") from exc

        try:
            entity = await asyncio.wait_for(client.get_entity(chat_id), timeout=15)
            result = await asyncio.wait_for(
                client(
                    GetForumTopicsRequest(
                        peer=entity,
                        offset_date=None,
                        offset_id=0,
                        offset_topic=0,
                        limit=20,
                        q="",
                    )
                ),
                timeout=20,
            )
            return [normalize_topic(topic) for topic in getattr(result, "topics", [])]
        except Exception as exc:
            raise wrap_telegram_error(exc) from exc

    async def list_messages(
        self,
        chat_id: int,
        *,
        topic_id: Optional[int] = None,
        before_id: Optional[int] = None,
        limit: int = 8,
    ) -> list[MessageSummary]:
        client = await self._get_client()
        try:
            entity = await asyncio.wait_for(client.get_entity(chat_id), timeout=15)
            kwargs: dict[str, Any] = {"limit": limit}
            if before_id is not None:
                kwargs["offset_id"] = before_id
            if topic_id is not None:
                try:
                    from telethon.tl.functions.messages import GetRepliesRequest
                except ImportError as exc:
                    raise TelegramServiceError("Telethon replies API is unavailable") from exc

                result = await asyncio.wait_for(
                    client(
                        GetRepliesRequest(
                            peer=entity,
                            msg_id=topic_id,
                            offset_id=before_id or 0,
                            offset_date=None,
                            add_offset=0,
                            limit=limit,
                            max_id=0,
                            min_id=0,
                            hash=0,
                        )
                    ),
                    timeout=20,
                )
                entities = [*getattr(result, "users", []), *getattr(result, "chats", [])]
                entities_by_peer = _entity_lookup(entities)
                return [normalize_message(message, entities_by_peer) for message in getattr(result, "messages", [])]

            messages = await asyncio.wait_for(client.get_messages(entity, **kwargs), timeout=20)
            return [normalize_message(message) for message in messages]
        except Exception as exc:
            raise wrap_telegram_error(exc) from exc

    async def send_message(
        self,
        chat_id: int,
        *,
        text: str,
        topic_id: Optional[int] = None,
    ) -> SendMessageResponse:
        client = await self._get_client()
        try:
            entity = await asyncio.wait_for(client.get_entity(chat_id), timeout=15)
            kwargs: dict[str, Any] = {}
            if topic_id is not None:
                kwargs["reply_to"] = topic_id
            sent = await asyncio.wait_for(client.send_message(entity, text, **kwargs), timeout=20)
            return SendMessageResponse(id=int(getattr(sent, "id")))
        except Exception as exc:
            raise wrap_telegram_error(exc) from exc
