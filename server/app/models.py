from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AuthStatus(ApiModel):
    configured: bool
    authorized: bool
    qr_login_available: bool = True


class QrLoginStart(ApiModel):
    token: str
    url: str
    expires_at: Optional[datetime] = None


class QrLoginStatus(ApiModel):
    authorized: bool
    expired: bool = False
    message: Optional[str] = None


class ChatSummary(ApiModel):
    id: int
    title: str
    kind: Literal["user", "group", "channel"]
    unread_count: int = 0
    is_forum: bool = False
    last_message: Optional[str] = None


class TopicSummary(ApiModel):
    id: int
    title: str
    top_message_id: int
    unread_count: int = 0


class MessageSummary(ApiModel):
    id: int
    sender: Optional[str] = None
    text: str
    sent_at: Optional[datetime] = None
    outgoing: bool = False


class SendMessageRequest(ApiModel):
    text: str = Field(min_length=1)
    topic_id: Optional[int] = None


class SendMessageResponse(ApiModel):
    id: int
    status: Literal["sent"] = "sent"


class TranscriptionResponse(ApiModel):
    text: str
    language: Optional[str] = None
    duration_seconds: Optional[float] = None
