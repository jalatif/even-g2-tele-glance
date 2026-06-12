import { describe, expect, it } from 'vitest'
import { pcmChunksToWav } from '../src/audio/wav'

function tonePcm(durationMs: number, freq: number, sampleRate = 16000): Uint8Array {
  const samples = Math.floor(sampleRate * durationMs / 1000)
  const buf = new Int16Array(samples)
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.floor(Math.sin(2 * Math.PI * freq * i / sampleRate) * 16000)
  }
  return new Uint8Array(buf.buffer)
}

function silencePcm(durationMs: number, sampleRate = 16000): Uint8Array {
  const bytes = Math.floor(sampleRate * durationMs / 1000) * 2
  return new Uint8Array(bytes)
}

async function wavBytes(wav: Blob): Promise<Uint8Array> {
  return new Uint8Array(await wav.arrayBuffer())
}

async function stringAt(bytes: Uint8Array, offset: number, length: number): Promise<string> {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

async function uint32At(bytes: Uint8Array, offset: number): Promise<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(offset, true)
}

async function uint16At(bytes: Uint8Array, offset: number): Promise<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint16(offset, true)
}

describe('pcmChunksToWav', () => {
  it('writes the RIFF header', async () => {
    const pcm = tonePcm(500, 1000)
    const wav = pcmChunksToWav([pcm])
    const b = await wavBytes(wav)
    expect(await stringAt(b, 0, 4)).toBe('RIFF')
    expect(await stringAt(b, 8, 4)).toBe('WAVE')
  })

  it('writes fmt chunk with correct sample rate', async () => {
    const pcm = silencePcm(250)
    const wav = pcmChunksToWav([pcm])
    const b = await wavBytes(wav)
    expect(await stringAt(b, 12, 4)).toBe('fmt ')
    expect(await uint32At(b, 24)).toBe(16000)
    expect(await uint16At(b, 22)).toBe(1)    // channels
    expect(await uint16At(b, 34)).toBe(16)   // bits per sample
  })

  it('writes data chunk with correct size', async () => {
    const pcm = silencePcm(100)
    const wav = pcmChunksToWav([pcm])
    const b = await wavBytes(wav)
    expect(await stringAt(b, 36, 4)).toBe('data')
    const dataSize = await uint32At(b, 40)
    expect(dataSize).toBe(pcm.byteLength)
  })

  it('sets total RIFF size to header+data', async () => {
    const pcm = tonePcm(200, 440)
    const wav = pcmChunksToWav([pcm])
    const b = await wavBytes(wav)
    const riffSize = await uint32At(b, 4)
    expect(riffSize).toBe(36 + pcm.byteLength)
  })

  it('produces correct total WAV byte size', () => {
    const pcm = silencePcm(300)
    const wav = pcmChunksToWav([pcm])
    expect(wav.size).toBe(44 + pcm.byteLength)
  })

  it('round-trips PCM data through chunks', async () => {
    const original = tonePcm(100, 880)
    const wav = pcmChunksToWav([original])
    const b = await wavBytes(wav)
    const dataSize = await uint32At(b, 40)
    const roundTripped = b.slice(44, 44 + dataSize)
    expect(roundTripped.length).toBe(original.length)
    expect(roundTripped).toEqual(original)
  })

  it('concatenates multiple chunks into contiguous PCM', async () => {
    const chunk1 = tonePcm(50, 500)
    const chunk2 = silencePcm(50)
    const chunk3 = tonePcm(50, 1000)
    const wav = pcmChunksToWav([chunk1, chunk2, chunk3])
    const b = await wavBytes(wav)
    const dataSize = await uint32At(b, 40)
    const roundTripped = b.slice(44, 44 + dataSize)

    const expected = new Uint8Array(chunk1.byteLength + chunk2.byteLength + chunk3.byteLength)
    expected.set(chunk1, 0)
    expected.set(chunk2, chunk1.byteLength)
    expected.set(chunk3, chunk1.byteLength + chunk2.byteLength)
    expect(roundTripped).toEqual(expected)
  })

  it('handles a single-byte chunk (odd byte count does not crash)', () => {
    const odd = new Uint8Array([0x00])
    const wav = pcmChunksToWav([odd])
    expect(wav.size).toBe(44 + 1)
  })

  it('handles empty chunk list (zero PCM)', () => {
    const wav = pcmChunksToWav([])
    expect(wav.size).toBe(44)
  })

  it('produces a valid WAV MIME type', () => {
    const pcm = silencePcm(100)
    const wav = pcmChunksToWav([pcm])
    expect(wav.type).toBe('audio/wav')
  })
})
