import os
import tempfile
from dataclasses import dataclass

from app.config import Settings
from app.models import TranscriptionResponse


class TranscriptionServiceError(RuntimeError):
    pass


@dataclass
class WhisperTranscriptionService:
    settings: Settings

    def __post_init__(self) -> None:
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise TranscriptionServiceError(
                    "faster-whisper is not installed. Install server requirements."
                ) from exc

            self._model = WhisperModel(
                self.settings.whisper_model,
                device=self.settings.whisper_device,
                compute_type=self.settings.whisper_compute_type,
            )
        return self._model

    async def transcribe_wav(self, wav_bytes: bytes) -> TranscriptionResponse:
        if not wav_bytes:
            raise TranscriptionServiceError("audio payload is empty")

        model = self._load_model()
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
                handle.write(wav_bytes)
                temp_path = handle.name

            segments, info = model.transcribe(temp_path)
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
            return TranscriptionResponse(
                text=text,
                language=getattr(info, "language", None),
                duration_seconds=getattr(info, "duration", None),
            )
        finally:
            if temp_path:
                os.unlink(temp_path)
