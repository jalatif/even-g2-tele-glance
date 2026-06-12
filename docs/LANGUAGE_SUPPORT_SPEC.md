# Multi-Language Support Specification

## Summary

Add UI localization for Japanese, Spanish, French, Korean, and Chinese with
auto-detection from Whisper transcription language or a user setting. Chat
names, message text, and topic names from Telegram are already rendered in
whatever language the sender wrote — this spec covers only the ~55 hardcoded
English UI strings in the app.

**CJK rendering on glasses is blocked on the Even Hub SDK** — the v0.0.10 SDK
has no font-loading API and the firmware LVGL build only supports basic Latin
glyphs. Until Even Realities ships font support, CJK UI strings and messages
on glasses use Latin-script transliteration as a fallback. The phone React UI
renders all scripts natively via CSS `font-family: Inter, ui-sans-serif`.

## Language scope

| Language | Script | Glasses glyphs? | Glasses fallback |
|---|---|---|---|
| English | Latin | Yes | — |
| Spanish | Latin | Yes (accents, ñ, ¿, ¡) | — |
| French | Latin | Yes (accents, ç, œ) | — |
| Japanese | Kanji + Kana | **No** | Latin transliteration (rōmaji) |
| Korean | Hangul | **No** | Latin transliteration (romaja) |
| Chinese | Hanzi | **No** | Latin transliteration (pīnyīn) |

Hindi is excluded — Devanagari script, same problems as CJK, would need its
own transliteration library.

## Current state

### What already works

- Telegram chat names, message text, and topic names are rendered as-is from
  the API and pass through `sanitizeGlassesText`. Spanish, French, and other
  Latin-script messages display correctly.
- Whisper already returns `info.language` in the transcription response
  (`server/app/services/transcription.py:57`). The detected language is
  stored in the response but not used by the frontend.
- The phone React UI uses `font-family: Inter, ui-sans-serif, system-ui` and
  can render all Unicode scripts that the OS supports.

### What's hardcoded

~55 English strings across 7 files:

| File | Count | Examples |
|---|---|---|
| `model.ts` | ~20 | `"Chats"`, `"Topics"`, `"No messages yet."`, `"Send"`, `"Cancel"`, `"[red]"`, `"[yellow]"`, `"[green]"`, `"Back"`, `"Recording..."`, `"Transcribing..."`, `"Sending..."`, `"Sent"`, `"Unknown"`, `"Me"`, `"New reply"`, `"Loading older messages..."`, `"Checking replies..."` |
| `appController.ts` | ~15 | `"Sent"`, `"Older messages"`, `"Newer messages"`, `"No older messages"`, `"Loading {chat} topics..."`, `"Loading {title}..."`, auth/error messages |
| `screens/ChatScreen.tsx` | ~10 | `"Chats"`, `"Telegram Login"`, `"Send"`, `"Verify Code"`, `"Recording on glasses…"`, `"No messages yet."` |
| `screens/SettingsScreen.tsx` | ~8 | `"Already connected"`, `"Not connected"`, `"Configured"`, `"Save Settings"`, `"Reset"` |
| `api.ts` | ~5 | `"Backend is not reachable..."`, timeout/encrypted-auth messages |
| `secureAuth.ts` | ~2 | `"Encrypted backend auth requires WebCrypto..."` |
| `App.tsx` | ~2 | `"TeleGlance"`, `"Settings"`, `"Back"` |

### Whisper language support

`faster-whisper` (`server/app/services/transcription.py:47`) calls
`model.transcribe()` without a `language` parameter — Whisper auto-detects
and returns `info.language`. The supported language codes (from the
`faster-whisper` tokenizer) include: `en`, `ja`, `es`, `fr`, `ko`, `zh`.

No `language` field exists in the transcribe request. The frontend POSTs only
the audio blob (`web/src/api.ts:transcribe`). The backend response includes
`language` and `duration_seconds` from `info`, but the frontend discards them.

### Glyph sanitization

`sanitizeGlassesText` (`model.ts:464-473`) strips:
- Status-circle emoji → ASCII labels (`🔴` → `[red]`)
- U+2757 (❗) and U+26A0 (⚠) — known LVGL `glyph dsc. not found` characters
- U+1F000–U+1FAFF (pictographic emoji, supplemental symbols)
- U+FE0F (variation selector)

Latin-1 and Latin-extended characters pass through untouched, including
accented letters (Spanish ñ, á, é, í, ó, ú, ü; French à, â, ç, è, é, ê, ë,
î, ï, ô, œ, ù, û, ÿ). These render correctly on the glasses.

## Phase 1 — Locale infrastructure (English only)

**Goal**: Extract all hardcoded English strings into a single locale module.
No behavioral change. All tests pass with identical output.

### 1.1 Create locale module

**New file: `web/src/locales/en.ts`**

```typescript
const en = {
  // --- Glasses display: titles ---
  sidebarTitleChats: 'Chats',
  sidebarTitleTopics: 'Topics',
  sidebarTitleMessages: 'Messages',
  titleLoading: 'TeleGlance',
  titleTranscribing: 'Transcribing...',
  titleConfirm: 'Confirm?',
  titleSending: 'Sending...',
  titleSent: 'Sent',
  titleRecording: 'Recording...',

  // --- Glasses display: status pills / footers ---
  statusSent: 'Sent',
  statusNewReply: 'New reply',
  statusCheckingReplies: 'Checking replies...',
  statusOlderMessages: 'Older messages',
  statusNewerMessages: 'Newer messages',
  statusNoOlderMessages: 'No older messages',
  statusLoadingOlder: 'Loading older messages...',
  footerBack: 'Back: double click',
  footerRecord: 'Record: click',
  footerConfirm: 'Select: swipe  Send: click',

  // --- Glasses display: content ---
  bodyNoMessages: 'No messages yet.',
  bodyLoadingTopics: (chatTitle: string) => `Loading ${chatTitle} topics...`,
  bodyLoadingMessages: (title: string) => `Loading ${title}...`,
  senderUnknown: 'Unknown',
  senderMe: 'Me',
  confirmSend: 'Send',
  confirmCancel: 'Cancel',

  // --- Glasses display: sanitization ---
  sanitizeRedCircle: '[red]',
  sanitizeYellowCircle: '[yellow]',
  sanitizeGreenCircle: '[green]',

  // --- Phone UI: ChatScreen ---
  phoneChatsHeading: 'Chats',
  phoneLoginHeading: 'Telegram Login',
  phoneSessionHeading: 'Telegram Session',
  phoneNewTelegram: 'New Telegram',
  phoneErrorHeading: 'Error',
  phoneVerificationCode: 'Verification code',
  phoneMobileNumber: 'Mobile number with country code',
  phoneSendButton: 'Send',
  phoneVerifyCode: 'Verify Code',
  phoneSendLoginCode: 'Send Login Code',
  phoneOpenThread: 'Open Thread',
  phoneRetry: 'Retry',
  phoneNoMessages: 'No messages yet.',
  phoneGlassesOff: 'Glasses screen is off…',
  phoneRecordingOnGlasses: 'Recording on glasses…',
  phoneTranscribing: 'Transcribing voice reply…',
  phoneConfirmOnGlasses: 'Confirm reply on glasses: …',
  phoneSendingReply: 'Sending reply…',
  phoneReplySent: 'Reply sent.',
  phoneOpenChatToSend: 'Open a chat or topic to send a reply.',
  phoneSendFailed: 'Send failed',
  phoneCodeSendFailed: 'Could not send code',
  phoneCodeVerifyFailed: 'Could not verify code',

  // --- Phone UI: SettingsScreen ---
  phoneSettingsHeading: 'Settings',
  phoneAlreadyConnected: 'Already connected',
  phoneNotConnected: 'Not connected',
  phoneConfigured: 'Configured',
  phoneRequired: 'Required',
  phoneStoredOnPhone: 'Stored on this phone only',
  phoneBackendSessionActive: 'Backend session active',
  phoneNotLoggedIn: 'Not logged in yet',
  phoneSaveSettings: 'Save Settings',
  phoneSaved: 'Saved',
  phoneReset: 'Reset',
  phoneDisconnectTelegram: 'Disconnect Telegram',
  phoneDisconnecting: 'Disconnecting...',

  // --- Phone UI: App shell ---
  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Settings',
  phoneBack: 'Back',
  phoneBackToChat: 'Back to chat',
  phoneOpenSettings: 'Open settings',

  // --- Error / auth messages ---
  errorBackendUnreachable: 'Backend is not reachable. Fill Backend URL in Settings and make sure the backend server is running.',
  errorBackendTimeout: (seconds: number) => `Backend request timed out after ${seconds}s. The server may be unreachable or stuck. Try again or check the backend.`,
  errorEncryptedAuthMissing: 'Encrypted auth requires Backend shared secret, Telegram API ID, and Telegram API hash in TeleGlance Settings.',
  errorSharedSecretRequired: 'Backend shared secret is required to decrypt backend response.',
  errorEncryptedMalformed: 'Encrypted backend response is malformed',
  errorWebCryptoRequired: 'Encrypted backend auth requires WebCrypto. Use the packaged app, localhost, HTTPS, or a browser with WebCrypto support.',
  errorUpdateStreamUnavailable: 'Update stream is unavailable',
  errorUpdateStreamFailed: 'Update stream failed',
  errorStarting: 'Starting...',
  errorStartupFailed: 'Startup failed',

  // --- Auth screens ---
  authNeedsSetup: 'Open Settings and fill Backend URL, Shared Secret, Telegram API ID, and Telegram API Hash. Then restart the app.',
  authSignedOut: 'Tap to log in with your phone number.',
  authPhonePending: 'Enter the verification code sent to your phone.',
} as const

export default en
export type LocaleStrings = typeof en
```

### 1.2 Create locale context

**New file: `web/src/locales/index.ts`**

```typescript
import en from './en'
import type { LocaleStrings } from './en'

let current: LocaleStrings = en

export function getLocale(): LocaleStrings {
  return current
}

export function setLocale(strings: LocaleStrings): void {
  current = strings
}

export type { LocaleStrings }
```

### 1.3 Refactor consumers

Every file that currently has a hardcoded English string imports `getLocale`
and uses the locale object instead. The refactor is mechanical:

**Before** (`model.ts`):
```typescript
title: 'Chats'
```

**After**:
```typescript
import { getLocale } from '../locales'
// ...
title: getLocale().sidebarTitleChats
```

Template strings with interpolation stay template strings:
```typescript
// Before
bodyLoadingTopics: (chatTitle: string) => `Loading ${chatTitle} topics...`
// After — the locale function uses the passed param
getLocale().bodyLoadingTopics(chat.title)
```

### 1.4 Test plan

No behavioral change — all 132 existing tests must pass with identical output.
Add one new test in `model.test.ts`:

```
it('uses locale strings for every user-visible label', () => {
  // Verify that getLocale() is called for every string in screenModel output
})
```

Every string in the locale file must be referenced by at least one source file.
Add a lint check or unit test that iterates locale keys and verifies they are
imported.

### Files touched

| File | Change |
|---|---|
| `web/src/locales/en.ts` | **New** — all English strings |
| `web/src/locales/index.ts` | **New** — get/set context |
| `web/src/controller/model.ts` | Replace ~20 hardcoded strings with `getLocale()` calls |
| `web/src/controller/appController.ts` | Replace ~15 hardcoded strings |
| `web/src/screens/ChatScreen.tsx` | Replace ~10 hardcoded strings |
| `web/src/screens/SettingsScreen.tsx` | Replace ~8 hardcoded strings |
| `web/src/api.ts` | Replace ~5 hardcoded strings |
| `web/src/secureAuth.ts` | Replace ~2 hardcoded strings |
| `web/src/App.tsx` | Replace ~2 hardcoded strings |
| `web/src/bridge/evenBridge.ts` | Replace 1 hardcoded string (`"Empty"`) |
| `web/test/model.test.ts` | Add locale-coverage assertion |

**Risk**: zero. Strings are identical, just looked up through an object.

---

## Phase 2 — Whisper language pipeline

**Goal**: Add optional language parameter to the transcribe API and store the
detected language for locale auto-detection.

### 2.1 Backend: accept language parameter

**`server/app/models.py`** — add optional `language` field:

```python
class TranscribeOptions(BaseModel):
    language: Optional[str] = Field(default=None, description="ISO 639-1 language code or 'auto' for detection")
```

**`server/app/main.py`** — accept options in the handler:

```python
@router.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    options: TranscribeOptions = Depends(),
    transcription: WhisperTranscriptionService = Depends(get_transcription_service),
):
    wav = pcm16le_to_wav(await audio.read())
    return await transcription.transcribe_wav(wav, options.language)
```

**`server/app/services/transcription.py`** — pass language to Whisper:

```python
async def transcribe_wav(self, wav_bytes: bytes, language: Optional[str] = None) -> TranscriptionResponse:
    # ...
    transcribe_kwargs = dict(
        beam_size=...,
        best_of=...,
        temperature=...,
        condition_on_previous_text=...,
    )
    if language and language != "auto":
        transcribe_kwargs["language"] = language
    segments, info = model.transcribe(temp_path, **transcribe_kwargs)
    # ...
```

### 2.2 Frontend: send language, store detected language

**`web/src/api.ts`** — add optional `language` parameter to `transcribe()`:

```typescript
async transcribe(wav: Blob, language?: string): Promise<TranscriptionResult> {
  const form = new FormData()
  form.append('audio', wav, 'recording.wav')
  if (language && language !== 'auto') {
    form.append('language', language)
  }
  // ... POST
}
```

**`web/src/controller/appController.ts`** — store detected language in state
and pass user-selected language when transcribing:

- Add `detectedLanguage?: string` to `AppState` for states that carry context
  (`sidebar.messages`, `sidebarConfirm`)
- In `handleSidebarRecording`: pass `this.sttLanguage` to `api.transcribe()`
- After transcription: store `result.language` in state as `detectedLanguage`
- Use `detectedLanguage` to resolve locale (Phase 3)

### 2.3 Settings UI: STT language selector

Add to `screens/SettingsScreen.tsx`:

```
STT Language: [Auto] [English] [Japanese] [Spanish] [French] [Korean] [Chinese]
```

Default: `"auto"` (Whisper auto-detects).

### Files touched

| File | Change |
|---|---|
| `server/app/models.py` | Add `TranscribeOptions` model |
| `server/app/main.py` | Accept options in `/api/transcribe` |
| `server/app/services/transcription.py` | Pass `language` to Whisper |
| `tests/backend/test_api.py` | Test language parameter passthrough |
| `web/src/api.ts` | Add `language` to `transcribe()` |
| `web/src/controller/appController.ts` | Store detected language, pass STT language |
| `web/src/screens/SettingsScreen.tsx` | Add STT language dropdown |
| `web/src/storage.ts` | Persist `sttLanguage` in frontend config |
| `web/src/types.ts` | Add `language` to `TranscriptionResult` |

---

## Phase 3 — Latin-script locale files (Spanish, French)

**Goal**: Add Spanish and French UI translations. Auto-detect locale from
Whisper language. All Latin-script glyphs render on glasses.

### 3.1 Create locale files

**`web/src/locales/es.ts`** — Spanish translations of all `LocaleStrings` keys.
**`web/src/locales/fr.ts`** — French translations.

Both follow the exact same key structure as `en.ts`. The `LocaleStrings` type
from Phase 1 enforces this at compile time.

### 3.2 Locale resolution

In `web/src/locales/index.ts`, add auto-detection:

```typescript
const LANG_TO_LOCALE: Record<string, LocaleStrings> = {
  en: en,
  es: es,
  fr: fr,
}

export function resolveLocale(detectedLanguage?: string, userOverride?: string): void {
  const lang = userOverride || detectedLanguage || 'en'
  // Map Whisper codes to locale modules
  const locale = LANG_TO_LOCALE[lang] || LANG_TO_LOCALE[lang.split('-')[0]] || en
  setLocale(locale)
}
```

### 3.3 Settings UI: UI language selector

Add to `screens/SettingsScreen.tsx`:

```
UI Language: [Auto] [English] [Spanish] [French]
```

Default: `"auto"` (resolved from detected STT language).

### 3.4 Test plan

- `model.test.ts`: add tests for Spanish/French locale string output
- `controller.test.ts`: add test that transcription with `language: "es"`
  sets `detectedLanguage` and resolves Spanish locale
- Manual QA: switch UI language to Spanish, verify every glasses screen
  shows Spanish text; verify accented characters render correctly

### Files touched

| File | Change |
|---|---|
| `web/src/locales/es.ts` | **New** — Spanish strings |
| `web/src/locales/fr.ts` | **New** — French strings |
| `web/src/locales/index.ts` | Add `resolveLocale()` |
| `web/src/controller/appController.ts` | Call `resolveLocale()` after transcription / on init |
| `web/src/screens/SettingsScreen.tsx` | Add UI language dropdown |
| `web/src/storage.ts` | Persist `uiLanguage` |
| `web/test/model.test.ts` | Locale-specific output tests |

---

## Phase 4 — CJK with Latin transliteration fallback (Japanese, Korean, Chinese)

**Goal**: Render CJK UI strings and messages in Latin script on the glasses
until the Even Hub SDK supports font loading. The phone React UI renders
native CJK characters normally.

### 4.1 Constraints

- Even Hub SDK v0.0.10 has no font-loading API — no `loadFont`, no
  `setLocale`, no codepage configuration on any container class
- LVGL firmware build only supports basic Latin glyphs
- CJK characters (U+4E00–U+9FFF, U+3040–U+30FF, U+AC00–U+D7AF) will
  produce `glyph dsc. not found` warnings and render as empty boxes
- This is exactly the same class of bug that `sanitizeGlassesText` already
  fixes for pictographic emoji (U+1F000–U+1FAFF)

### 4.2 Transliterated locale files

Create locale files using Latin script:

| File | Language | Script | Example |
|---|---|---|---|
| `web/src/locales/ja.ts` | Japanese | Rōmaji | `sidebarTitleChats: 'Chatto'` |
| `web/src/locales/ko.ts` | Korean | Romaja | `sidebarTitleChats: 'Chaeting'` |
| `web/src/locales/zh.ts` | Chinese | Pīnyīn | `sidebarTitleChats: 'Liáotiān'` |

For chat names and message content from Telegram (which are user data, not
UI strings), apply a transliteration pass in `sanitizeGlassesText`.

### 4.3 CJK sanitization

Extend `sanitizeGlassesText` to transliterate CJK characters to Latin script
when the locale is a CJK language.

**Option A — character-level replacement (recommended)**:

Use a mapping of the most common CJK characters to Latin equivalents.
Coverage is limited to ~2000 characters but avoids adding a heavy
dependency. Good enough for short UI strings, not for full message text.

**Option B — library-based transliteration**:

Use `kuroshiro` + `kuroshiro-analyzer-kuromoji` for Japanese, `pinyin` for
Chinese, and a small Hangul→Romaja mapping for Korean. Adds ~200KB
(minified) to the frontend bundle. Higher quality but heavier.

**Option C — backend transliteration**:

Send non-Latin text to the backend for transliteration before rendering.
Adds network latency and backend dependency for what should be a local
operation. Not recommended for v1.

**Recommendation**: Option A for Phase 4 (lightweight, no dependency, covers
UI strings). Option B as a follow-up for full message transliteration.

### 4.4 `sanitizeGlassesText` changes

After existing sanitization, add a CJK pass when the locale requires it:

```typescript
function sanitizeGlassesText(value: string, locale: LocaleStrings): string {
  let result = value
  // ... existing emoji/status-circle replacements ...
  if (localeNeedsTransliteration(locale)) {
    result = transliterateCJK(result)
  }
  return result
}
```

The `localeNeedsTransliteration` check returns true for `ja`, `ko`, `zh` and
false for `en`, `es`, `fr`.

### 4.5 What's NOT done in this phase

- Full native CJK rendering (blocked on SDK)
- CJK input (keyboard/microphone input in CJK languages — this is already
  handled by the phone OS keyboard and Whisper transcription, both of which
  support CJK natively)
- Transliteration of CJK in chat/topic names (these are proper nouns and
  transliteration would be jarring — leave as-is; they'll show as boxes
  on glasses but are correct on phone)

### Files touched

| File | Change |
|---|---|
| `web/src/locales/ja.ts` | **New** — Rōmaji strings |
| `web/src/locales/ko.ts` | **New** — Romaja strings |
| `web/src/locales/zh.ts` | **New** — Pīnyīn strings |
| `web/src/locales/index.ts` | Add `ja`/`ko`/`zh` to `LANG_TO_LOCALE` |
| `web/src/controller/model.ts` | Pass locale to `sanitizeGlassesText`; add CJK transliteration |
| `web/src/screens/SettingsScreen.tsx` | Add Japanese/Korean/Chinese to UI language dropdown |

---

## Phase 5 — Native CJK rendering (when SDK supports fonts)

**Goal**: Remove transliteration fallback and render native CJK characters on
glasses. This phase is blocked on an Even Hub SDK update.

### 5.1 Prerequisites

- Even Hub SDK exposes `loadFont(fontData: ArrayBuffer, codepage: string)`
  or equivalent API
- Even Hub firmware supports multi-font LVGL rendering
- Font files are packaged in the `.ehpk` (or loaded at runtime via SDK API)

### 5.2 Changes

- Remove transliteration pass from `sanitizeGlassesText`
- Replace `ja.ts`/`ko.ts`/`zh.ts` with native-script versions
- Load CJK font files at app startup
- Verify CJK glyphs render on the glasses display (LVGL `glyph dsc. not
  found` must not appear)
- Golden screenshot tests for CJK content

### 5.3 Font candidates

| Language | Font | Size (WOFF2) | Coverage |
|---|---|---|---|
| Japanese | Noto Sans JP | ~4MB | JIS Level 1-4, 7,000+ kanji |
| Korean | Noto Sans KR | ~3MB | KS X 1001, 2,500+ hangul |
| Chinese | Noto Sans SC | ~5MB | GB 2312, 6,700+ hanzi |

These are too large to ship in the `.ehpk` (which has limited storage).
The SDK font API would ideally support streaming or on-demand loading.
Simplified subsets covering the ~500 most common characters per language
may be needed for v1.

---

## Non-goals

- **Message translation**: Telegram messages are user content. Translating
  them would be unexpected and wrong. Only UI chrome is localized.
- **Backend translation API**: No Google Translate / DeepL integration.
- **Custom font rendering**: No bitmap font pipeline that bypasses the SDK.
- **Hindi / Arabic / Thai / other scripts**: Excluded from this spec. Same
  font-blocker problem. Can be added with the same transliteration pattern.
- **RTL layout**: Arabic and Hebrew excluded. Even Hub LVGL does not
  support RTL text containers.

---

## Backward compatibility

All phases are additive. Phase 1 is a pure refactor with identical output.
Phases 2-5 add new locale files and optional Settings toggles. Default
behavior matches current behavior: English locale, auto-detect Whisper
language, no CJK transliteration until explicitly enabled.

## Verification checklist

- [ ] 132 unit tests pass with locale infrastructure (Phase 1)
- [ ] 56/56 simulator steps pass (Phase 1)
- [ ] Spanish/French locale files have 100% key coverage (Phase 3)
- [ ] Spanish/French glasses screens render accented characters (manual QA)
- [ ] Whisper language parameter round-trips correctly (Phase 2)
- [ ] Detected language resolves correct locale (Phase 3)
- [ ] CJK transliteration produces readable Latin output (Phase 4)
- [ ] CJK locale files have 100% key coverage (Phase 4)
- [ ] No `glyph dsc. not found` warnings for new locale strings (all phases)
- [ ] Settings UI language selector works end-to-end (Phase 3/4)
