from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    telegram_api_id: Optional[int] = Field(default=None, validation_alias="TELEGRAM_API_ID")
    telegram_api_hash: Optional[str] = Field(default=None, validation_alias="TELEGRAM_API_HASH")
    telegram_session_path: Path = Field(
        default=Path("server/data/telegram.session"),
        validation_alias="TELEGRAM_SESSION_PATH",
    )
    backend_cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        validation_alias="BACKEND_CORS_ORIGINS",
    )
    backend_cors_origin_regex: Optional[str] = Field(default=None, validation_alias="BACKEND_CORS_ORIGIN_REGEX")
    tailscale_enabled: bool = Field(default=True, validation_alias="TAILSCALE_ENABLED")
    whisper_model: str = Field(default="base", validation_alias="WHISPER_MODEL")
    whisper_device: str = Field(default="auto", validation_alias="WHISPER_DEVICE")
    whisper_compute_type: str = Field(default="int8", validation_alias="WHISPER_COMPUTE_TYPE")
    whisper_beam_size: int = Field(default=1, validation_alias="WHISPER_BEAM_SIZE")
    whisper_best_of: int = Field(default=1, validation_alias="WHISPER_BEST_OF")
    whisper_temperature: float = Field(default=0.0, validation_alias="WHISPER_TEMPERATURE")
    whisper_condition_on_previous_text: bool = Field(
        default=False,
        validation_alias="WHISPER_CONDITION_ON_PREVIOUS_TEXT",
    )

    model_config = SettingsConfigDict(env_file=("server/.env", ".env"), extra="ignore")

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def resolve_paths(self) -> "Settings":
        if not self.telegram_session_path.is_absolute():
            repo_root = Path(__file__).resolve().parents[2]
            self.telegram_session_path = (repo_root / self.telegram_session_path).resolve()
        if self.tailscale_enabled and self.backend_cors_origin_regex is None:
            self.backend_cors_origin_regex = r"^https?://(localhost|127\.0\.0\.1|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3})(:\d+)?$"
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
