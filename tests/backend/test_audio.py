import io
import wave

import pytest

from app.services.audio import pcm16le_to_wav


def test_pcm16le_to_wav_wraps_even_pcm_bytes():
    wav_bytes = pcm16le_to_wav(b"\x00\x00\xff\x7f", sample_rate=16000)

    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getframerate() == 16000
        assert wav.readframes(2) == b"\x00\x00\xff\x7f"


def test_pcm16le_to_wav_rejects_odd_byte_count():
    with pytest.raises(ValueError):
        pcm16le_to_wav(b"\x00")
