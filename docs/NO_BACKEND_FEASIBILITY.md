# TeleGlance "No Backend" Feasibility

## What the backend does today

The FastAPI backend at `server/app/` owns eight capabilities. Each row below lists the replacement that a pure-frontend build would require.

| # | Capability | Current location | Frontend-only replacement | Parity risk | Concrete obstacle |
|---|---|---|---|---|---|
| 1 | MTProto phone-code login | `server/app/services/telegram.py` `start_phone_login` / `complete_phone_login` | JS MTProto client calling `auth.sendCode` over WSS | Med | Phone-code entry in a 576×288 WebView; GramJS `client.start({phoneNumber,phoneCode})` is untested on this WebView |
| 2 | MTProto dialogs/history/topics/send/ack | `server/app/services/telegram.py` `get_dialogs`, `GetRepliesRequest`, `send_message`, `send_read_acknowledge` | GramJS `client.invoke` calls over WSS, update handlers in the WebView | Low | GramJS supports everything the backend currently calls; transport over `wss://venus.web.telegram.org:443/apiws1` is proven by `telegram-tt` |
| 3 | StringSession lifecycle | `TelethonTelegramService.complete_phone_login` → `StringSession.save()`, returned to frontend | `StringSession.save()` in the browser via GramJS `client.session.save()` | Low | GramJS `StringSession` is a first-class output; store via Even Hub SDK `bridge.setLocalStorage` for durability across reinstalls |
| 4 | Encrypted `X-TeleGlance-Auth` envelope | `server/app/services/secure_auth.py` + `web/src/secureAuth.ts` (AES-GCM + PBKDF2-SHA256, 200k iters, 12-byte nonce, 300 s replay window, ±120 s clock skew) | Drop the shared secret; the MTProto auth_key is the secret | Low | No longer needed for Telegram traffic — DH exchange + auth_key from MTProto takes its place |
| 5 | Whisper transcription | `server/app/services/transcription.py` `WhisperTranscriptionService` wrapping `faster-whisper.WhisperModel` | transformers.js + onnxruntime-web + `Xenova/whisper-tiny.en` INT8 | High | 44 MB download, WASM SIMD + cross-origin isolation required, English-only, 4-6x real-time on mid-tier phone hardware |
| 6 | Tailscale / LAN / CORS routing | `server/app/config.py` `BACKEND_CORS_ORIGINS` regex + `scripts/configure-tailscale.mjs` substituting `http://<BACKEND_URL>:8787` in `app.json` | `app.json` network whitelist points at `wss://*.web.telegram.org` and `https://huggingface.co` for model download | Low | No backend to route to; drop the Tailscale machinery |
| 7 | HTTP fetch wrapper + SSE | `web/src/api.ts` `HttpTelegramApi`, `ReadableStream`-based SSE on `/api/updates` | `GramJSTelegramApi` implementing the same `TelegramApi` interface; GramJS update handlers replace SSE | Low | Same interface, different backend; no codegen needed |
| 8 | Debug event buffer | `server/app/main.py` `POST/GET/DELETE /api/debug/events`, in-memory deque gated by encrypted auth | `IndexedDB`-backed ring buffer in the WebView | Low | Already on-device; no auth needed |

All rows confirmed by reading `server/app/main.py`, `server/app/services/telegram.py`, and `server/app/services/transcription.py`.

## Per-capability feasibility

### 1. MTProto transport — Feasible

Telegram's transport spec ([core.telegram.org/mtproto/transports](https://core.telegram.org/mtproto/transports)) defines flag `w` (CORS for browsers) and flag `s` (WebSocket). The WSS endpoints `wss://<name>.web.telegram.org:443/apiws1` (e.g. `wss://venus.web.telegram.org:443/apiws1`) carry CORS headers and accept `Sec-WebSocket-Protocol: binary`.

The "no CORS" reading of Telegram's API comes from a 404 on `core.telegram.org/api/cors` — that page never existed; CORS is documented inline in the transports page. There is no JSONP path and no fetch/XHR path; the only CORS-compatible transport is WSS.

**Verdict: Feasible**, but only over WSS with `Sec-WebSocket-Protocol: binary`.

Source: `agent://MapTgMtprotoBrowserOptions` (research subagent output, library survey and Telegram transport doc analysis).

### 2. MTProto library — Feasible (single choice)

Of the four candidates surveyed, the only maintained, production-used JS MTProto client is **GramJS** (`telegram` on npm, `2.26.22`, MIT, 1.8k stars, 154k weekly downloads, last release Feb 13 2025; browser bundle `2.26.21`). It supports phone-code auth (`client.start({phoneNumber, phoneCode, password})`), `channels.getForumTopics`, `messages.getReplies`, and `messages.sendMessage` — every Telegram call the backend currently makes. GramJS ships a `generate_webpack.js` and a `browser/telegram.js` build target; the official `telegram-tt` (Telegram's own web client) is a fork of it and runs in a normal browser.

Disqualified candidates:
- `@mtproto/core` `6.3.0` — archived Sep 2024, TL layer 158 (two years old), GPL-3.0.
- `tdweb` `1.8.0` — last release Dec 2021, bundle 28.26 MB unpacked (WASM ~6-8 MB + JS glue).
- `telegram-mtproto` (PaulSonOfLair) — deleted (404).

Real-world bundle size for a GramJS browser build: 800 KB - 1.5 MB minified, **250-400 KB gzipped** — the floor for a supported, schema-covered, maintained client.

**Verdict: Feasible**, with the caveat that GramJS is the only option and its bundle at 250-400 KB gzipped competes with the Even Hub `.ehpk` packaging limit and cold-start latency.

Source: `agent://MapTgMtprotoBrowserOptions` library table.

### 3. Whisper in the WebView — Borderline (English-only)

Three libraries surveyed: whisper.cpp WASM, `@huggingface/transformers` v4.x with `onnxruntime-web` 1.26, and raw `onnxruntime-web`. The only path that fits a 1-30 s English voice message in a phone WebView is **transformers.js + `Xenova/whisper-tiny.en` INT8**. Bundle breakdown:

- `ort-wasm-simd-threaded.wasm` = 13.0 MB (gzipped ≈ 4-5 MB)
- `ort.min.mjs` = 360 KB
- `@huggingface/transformers` JS ≈ 1.0 MB minified, ≈ 350 KB gzipped
- Xenova/whisper-tiny.en INT8: encoder 10.12 MB + decoder 30.73 MB + tokenizer/config 3.6 MB
- **Total raw: ~44 MB, total gzipped: ~14-18 MB for first-run download**

whisper.cpp WASM ships ggml `tiny.en` as **75 MiB FP16** with no officially distributed int8 variant for tiny — disqualified unless hand-converted. transformers.js v3+ dtype API supports q4/q8/int8/fp16/fp32 per-module; the encoder must stay fp16/uint8 because q4 on the Whisper encoder measurably hurts WER (confirmed in the Xenova/HuggingFace docs and issues).

**Verdict: Borderline feasible** for English-only on high-end phones, but not a drop-in replacement for `faster-whisper`.

Source: `agent://MapBrowserWhisperOptions` library table; model files at `huggingface.co/Xenova/whisper-tiny.en/tree/main/onnx`.

### 4. Whisper on the target WebView — Not Feasible below spec

Three hard constraints:

1. **WASM SIMD 128 is mandatory.** Android System WebView < 90 and iOS WKWebView < 16.4 have no SIMD. The scalar fallback is 4-10x slower. Benchmark: M1 WASM tiny encode at 3.8 s vs 100 ms native NEON (whisper.cpp issue #89).

2. **Threaded WASM requires cross-origin isolation.** `SharedArrayBuffer` needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers. The Even Hub `.ehpk` host page typically cannot set these, so the WebView silently falls back to single-thread WASM (≈ half throughput). (onnxruntime-web docs and transformers.js issue #1698).

3. **Heap limits on older phones.** iOS WKWebView per-WebView heap is ~1-1.5 GB; Android System WebView is 2-4 GB. **tiny** fits; **small/medium OOM-crash**. Reported tiny.en INT8 on a Snapdragon 7xx-class phone: **~4-6x real-time** — a 10 s clip transcribes in 40-60 s, not interactive for voice messages.

Non-English is not viable on tiny.en; the model is English-only.

**Verdict: Not Feasible as a drop-in replacement for `faster-whisper`.** Acceptable only as an English-only, hardware-tolerant fallback with a server-Whisper escape hatch.

Source: `agent://MapBrowserWhisperOptions` — SIMD, COOP/COEP, and heap sections; Snapdragon 7xx benchmark.

### 5. StringSession in browser storage — Feasible (threat model unchanged)

The GramJS `StringSession` is a base64 of the MTProto 2048-bit auth_key plus dc_id flag and LAYER prefix — functionally a saved password. The current code already stores it in `localStorage` plaintext on the phone (see `SECURITY_PRIVACY.md` §6); the AES-GCM envelope in `X-TeleGlance-Auth` only protects it in flight. A pure-browser client does not change the at-rest threat model.

The Even Hub SDK's `bridge.getLocalStorage`/`setLocalStorage` store is more durable than the WebView's `localStorage` across reinstalls (confirmed by `EVEN_REALITIES_HW.md`: "phone packaged WebView `localStorage` is not reliable across reopen/update").

**Verdict: Feasible** with no regression in the existing threat model.

### 6. First-paint latency on real G2 — Marginal

The current backend-mediated design lets the first paint use cached chats and overlays network round trips in the background. A pure-browser client must:
1. Load ~250-400 KB gzipped JS
2. Run a TL schema parse
3. Complete a WSS handshake to `wss://venus.web.telegram.org:443/apiws1`
4. Restore or re-establish the `StringSession`
5. Render the chat list

The team has already observed real-G2 input lag in the 100s-of-ms range from SDK normalization (per `EVEN_REALITIES_HW.md` idle doublePress events and the input-dispatch latency instrumentation). A GramJS handshake on the same JS thread competes directly.

Realistic added cold-start on real G2: **~1 s**. The current backend can show cached data in < 200 ms.

**Verdict: Marginal** — workable for a user willing to wait, but a regression from the current experience.

### 7. Phone-code login on the glasses UX — Feasible but worse

Phone-code auth in a 576×288 WebView is a worse experience than on a phone. The current backend-mediated design lets the user log in from a real browser once, then use the glasses seamlessly. A direct browser MTProto client must re-implement the key-into-WebView flow on the glasses — phone number entry on an on-screen keyboard, code entry, and 2FA password.

**Verdict: Feasible** but a UX regression.

### 8. Replay window and clock skew — Trivially drops

The ±120 s clock skew window and the 300 s replay-nonce cache in `server/app/services/secure_auth.py` protect a network auth channel. With MTProto over WSS, Telegram's own DH exchange + auth_key validation takes their place. The shared-secret envelope is no longer needed for Telegram traffic; it is still needed for any frontend → custom-relay channel if one is ever added.

**Verdict: Drops trivially** — no replacement needed.

## Verdict

> **Frontend-only is not achievable with full feature parity for the current self-hosted v1.** MTProto in the WebView is feasible (GramJS over WSS to `wss://venus.web.telegram.org:443/apiws1`), but Whisper in the WebView is not a drop-in for `faster-whisper` on the target WebView (low-end Android WebView, iOS WKWebView, phones < 3 GB RAM). Tiny.en INT8 is the only path that runs at all, it requires WASM SIMD + cross-origin isolation, it is English-only, and it is 4-6x real-time on a mid-tier phone — not interactive for a voice-message UX. The current backend's local Whisper is faster than the in-WebView path on every supported device. The frontend can keep the glasses offline-tolerant for **chat reads** (cached chats, cached topics, cached message pages) but **cannot** transcribe voice replies or send Telegram messages without a network path to either Telegram's MTProto servers or a self-hosted relay. The "no backend" design is therefore "no local backend but a thin hosted or WSS relay," not "no server at all."

The team's AGENTS.md is correct: `The frontend calls only the backend, not Telegram directly, to avoid WebView/CORS issues.` CORS is solvable; bundle size, cold-start, and the Whisper runtime are not.

## Tradeoff matrix

| Feature | Current (FastAPI + Telethon + faster-whisper) | Pure-browser (GramJS + transformers.js) | Hybrid: thin MTProto relay + browser Whisper | Hybrid: thin relay for both |
|---|---|---|---|---|
| Chat list, history, send, ack, forum topics, live updates | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Phone-code login | ✅ Once in real browser, then seamless | ❌ Key-into-WebView on glasses | ✅ Once in real browser | ✅ Once in real browser |
| Voice reply (record → transcribe → confirm → send) | ✅ Local, fast, any language | ❌ English-only, 4-6x real-time, 1st-run 44 MB download | ❌ Same browser Whisper limits | ✅ Server Whisper, fast |
| StringSession at rest | ✅ In localStorage + SDK store | ✅ Same threat model | ✅ Same | ✅ Same |
| Cold-start latency on real G2 | ✅ < 200 ms (cached data) | ⚠️ ~1 s (GramJS handshake + schema) | ⚠️ Relay handshake ~500 ms | ⚠️ Relay handshake ~500 ms |
| .ehpk size | ~200 KB (no addl dependencies) | ⚠️ +250-400 KB gzipped GramJS | ⚠️ Same | ~200 KB |
| First-run download size | None (no model download) | ❌ ~14-18 MB (ONNX + WASM) | ❌ Same browser Whisper path | ✅ None |
| Works on low-end Android / iOS X-class | ✅ | ❌ No WASM SIMD, heap < 1.5 GB | ❌ Same browser limits | ✅ Relay runs anywhere |
| Works offline for reads (cached) | ✅ | ✅ (same cache model) | ✅ | ✅ |
| Works on non-English voice | ✅ | ❌ tiny.en is English-only | ❌ Same | ✅ |
| Operator burden | ⚠️ Runs `scripts/start-backend.sh` on local host | ✅ None | ⚠️ Maintain hosted relay | ⚠️ Maintain hosted relay + Whisper server |
| Threat model (network passive observer) | ✅ Encrypted X-TeleGlance-Auth | ⚠️ Over WSS to Telegram DC (TLS) | ⚠️ Over WSS to relay + relay to Telegram | ⚠️ Over WSS to relay + relay to Telegram |
| v1 scope alignment | ✅ "Self-hosted Telegram account" | ❌ No backend requires GramJS fork maintenance | ❌ Outside "self-hosted v1" scope | ❌ Outside "self-hosted v1" scope |

## Contingency paths

### Path A — Keep the current backend (Recommended)

No code change. The backend keeps doing MTProto (Telethon) + Whisper (faster-whisper) on the user's local host or Tailscale/LAN. The frontend keeps the `HttpTelegramApi` + `X-TeleGlance-Auth` envelope. This document records the rationale so future engineers do not re-derive the same conclusion.

Tradeoffs: zero churn, full parity across all features, requires the user to run `scripts/start-backend.sh` and keep it reachable from the phone. Aligns with the AGENTS.md "self-hosted v1" scope.

### Path B — Drop local Whisper, keep local MTProto backend

Replace `faster-whisper` with a hosted Whisper endpoint (OpenAI, Groq, self-hosted whisper.cpp HTTP). The frontend keeps the optional `STT Server Url (Optional)` field that already exists in `SECURITY_PRIVACY.md` §1 and `EVEN_REALITIES_HW.md`'s audio section. Drops the heaviest local dependency (Python+CUDA/Rocm, model file), keeps MTProto in the safe place.

Tradeoff: privacy shifts to whoever runs the STT endpoint. The existing contract "Custom STT endpoints never receive Telegram auth headers" must stay.

### Path C — Build a frontend-only build behind a feature flag (Largest effort)

Concrete steps if chosen:

1. Add GramJS `2.26.x` and a `GramJSTelegramApi` adapter implementing the `TelegramApi` interface in `web/src/api.ts:17-29`.
2. Add `@huggingface/transformers` v4 + `onnxruntime-web` 1.26 + `Xenova/whisper-tiny.en` INT8 and a `TransformersJsTranscriptionService` implementing the same `TranscribeAudio(wav: Blob) -> Promise<TranscriptionResult>` contract the backend exposes at `web/src/api.ts:27`.
3. Store the `StringSession` via `bridge.getLocalStorage`/`setLocalStorage` (Even Hub SDK store, more durable than `localStorage`).
4. Update `app.json` `network` whitelist to `wss://*.web.telegram.org` and `https://huggingface.co` (for model download). Keep `http://localhost:8787` and `http://127.0.0.1:8787` for the backend-mode shim.
5. Measure real G2 cold-start vs. simulator vs. the current backend-mode numbers. Treat ≥ 1 s regression as a blocker for v1 cutover.
6. Gate the entire build behind a `VITE_NO_BACKEND=1` env var and a phone-Settings toggle so users can fall back to backend mode.

Tradeoff: a feature flag is the only safe way to ship this without regressing v1. The current backend is not removed; it is bypassed.

## References

- Backend inventory: `server/app/main.py`, `server/app/services/telegram.py`, `server/app/services/transcription.py`
- SDK constraints: `app.json`, `web/package.json` (`@evenrealities/even_hub_sdk ^0.0.10`)
- Auth envelope: `web/src/secureAuth.ts`, `server/app/services/secure_auth.py`
- Hardware notes: `EVEN_REALITIES_HW.md`
- Security/privacy: `SECURITY_PRIVACY.md`
- GramJS: [npm/telegram 2.26.22](https://www.npmjs.com/package/telegram), [repo](https://github.com/gram-js/gramjs)
- Telegram transport spec: [core.telegram.org/mtproto/transports](https://core.telegram.org/mtproto/transports)
- Whisper tidy.en ONNX: [huggingface.co/Xenova/whisper-tiny.en](https://huggingface.co/Xenova/whisper-tiny.en/tree/main/onnx)
- transformers.js: [repo](https://github.com/huggingface/transformers.js), v4.2.0 (2026-04-23)
- onnxruntime-web: [npm](https://www.npmjs.com/package/onnxruntime-web), 1.26.0
- whisper.cpp WASM: [repo/examples/whisper.wasm](https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.wasm)
