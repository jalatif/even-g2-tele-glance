from pathlib import Path

from app.config import Settings


def test_telegram_session_path_resolves_from_repo_root():
    settings = Settings(
        TELEGRAM_SESSION_PATH="server/data/telegram.session",
        BACKEND_CORS_ORIGINS=[],
    )

    assert settings.telegram_session_path.is_absolute()
    assert settings.telegram_session_path == (
        Path(__file__).resolve().parents[2] / "server/data/telegram.session"
    ).resolve()


def test_tailscale_cors_regex_is_enabled_by_default():
    settings = Settings(
        TELEGRAM_SESSION_PATH="server/data/telegram.session",
        BACKEND_CORS_ORIGINS=[],
    )

    assert settings.tailscale_enabled is True
    assert settings.backend_cors_origin_regex is not None
    assert "100\\." in settings.backend_cors_origin_regex
