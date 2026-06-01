from app.config import Settings


def test_tailscale_cors_regex_is_enabled_by_default():
    settings = Settings(
        BACKEND_CORS_ORIGINS=[],
    )

    assert settings.tailscale_enabled is True
    assert settings.backend_cors_origin_regex is not None
    assert "100\\." in settings.backend_cors_origin_regex
