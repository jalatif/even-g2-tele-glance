import io
import wave


def pcm16le_to_wav(
    pcm: bytes,
    *,
    sample_rate: int = 16000,
    channels: int = 1,
) -> bytes:
    if channels < 1:
        raise ValueError("channels must be positive")
    if sample_rate < 1:
        raise ValueError("sample_rate must be positive")
    if len(pcm) % 2 != 0:
        raise ValueError("16-bit PCM data must contain an even number of bytes")

    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return output.getvalue()
