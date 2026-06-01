from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from app.services.telegram import normalize_dialog, normalize_message, normalize_topic


@dataclass
class Entity:
    id: int
    title: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    forum: bool = False
    broadcast: bool = False
    bot: bool = False


@dataclass
class Dialog:
    entity: Entity
    unread_count: int
    message: object


@dataclass
class Message:
    id: int
    message: str
    date: datetime
    out: bool = False
    sender: Optional[Entity] = None


@dataclass
class Topic:
    id: int
    title: str
    top_message: int
    unread_count: int = 0


def test_normalize_dialog_from_user_entity():
    dialog = Dialog(
        entity=Entity(id=42, first_name="Ada", last_name="Lovelace"),
        unread_count=3,
        message=Message(id=9, message="Last note", date=datetime.now(timezone.utc)),
    )

    chat = normalize_dialog(dialog)

    assert chat.id == 42
    assert chat.title == "Ada Lovelace"
    assert chat.kind == "user"
    assert chat.unread_count == 3
    assert chat.last_message == "Last note"


def test_normalize_forum_group_and_topic():
    dialog = Dialog(
        entity=Entity(id=100, title="Core Team", forum=True),
        unread_count=0,
        message=None,
    )

    chat = normalize_dialog(dialog)
    topic = normalize_topic(Topic(id=7, title="Release", top_message=77, unread_count=1))

    assert chat.kind == "group"
    assert chat.is_forum is True
    assert topic.top_message_id == 77


def test_normalize_message_sender_and_outgoing_flag():
    message = Message(
        id=12,
        sender=Entity(id=1, username="owner"),
        message="On it",
        date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        out=True,
    )

    normalized = normalize_message(message)

    assert normalized.id == 12
    assert normalized.sender == "@owner"
    assert normalized.text == "On it"
    assert normalized.outgoing is True
