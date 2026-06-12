# Multi-Language Harness Plan

This plan is a companion to `LANGUAGE_SUPPORT_SPEC.md`. It covers every testing
surface — unit tests, simulator flow, fixture API, golden files, and catalog —
that must change to validate multi-language support end-to-end.

## Design principle

**Test the mechanism, not the matrix.** We do not run 56 catalog steps × 5
languages. Instead:

1. Add a **sampling set** of ~8 catalog steps that exercise the key screens in
   each Latin-script language (Spanish, French).
2. Add a **locale-switch step** that toggles the locale mid-run and verifies
   the UI re-renders.
3. Add **locale-aware unit tests** that cover every locale string in isolation.
4. For CJK (Phase 4), add transliteration tests that verify output is Latin
   script with no `glyph dsc. not found` characters.
5. Keep the existing 56-step catalog running in English — it is the baseline.

## Changes by layer

### 1. Fixture API (`web/src/fixtureApi.ts`)

#### 1.1 `setLocale` command

Add a new fixture command that switches the locale at runtime:

```typescript
case 'setLocale':
  if (typeof cmd.locale === 'string') {
    setLocale(resolveLocale(cmd.locale))
  }
  break
```

The harness drives this via `POST /api/test/fixture-commands`:

```json
{ "kind": "setLocale", "locale": "es" }
```

#### 1.2 Multilingual fixture data

Add Spanish and French chat/topic/message fixtures. These are used by the
locale-specific catalog steps.

**`web/src/fixtureApi.ts`** — new fixture dataset:

```typescript
const SPANISH_CHATS: Chat[] = [
  { id: 'es-1', title: 'Familia', kind: 'user' },
  { id: 'es-2', title: 'Proyecto Solar', kind: 'forum', topicCount: 3 },
]

const SPANISH_MESSAGES: Message[] = [
  { id: 'es-100', sender: 'Mamá', text: '¿Cómo estás?', sentAt: '...' },
  { id: 'es-101', sender: 'Tú', text: '¡Muy bien! ¿Y tú?', sentAt: '...' },
]

const FRENCH_CHATS: Chat[] = [
  { id: 'fr-1', title: 'Famille', kind: 'user' },
  { id: 'fr-2', title: 'Projet Soleil', kind: 'forum', topicCount: 2 },
]
```

These are gated behind the locale mode — when `locale === 'es'`, the fixture
API returns Spanish data; when `locale === 'fr'`, French data.

#### 1.3 Storage key

The `setLocale` command writes to the same storage layer as other settings
(`web/src/storage.ts`). The harness does not need to mock storage — the
controller reads locale from the same path it reads backend URL and Telegram
credentials.

### 2. Catalog (`docs/UI_INVARIANTS.json`)

#### 2.1 New screens

Add locale-specific screen blocks for every screen that has locale-dependent
content. These share the same structure as existing screens but define
locale-specific rendering invariants.

```json
{
  "id": "sidebar.chats.es",
  "kind": "sidebar",
  "left": { "title": "Chats", "items": ["Familia", "Proyecto Solar"] },
  "right": { "title": "Familia", "body": "¿Cómo estás?" }
}
```

#### 2.2 New steps — sampling set

Add ~8 steps that exercise key screens in each Latin-script language:

| Step ID | Language | Screen | What it validates |
|---|---|---|---|
| `l10n-es-startup` | Spanish | `sidebar.chats` | Chat list renders Spanish titles |
| `l10n-es-messages` | Spanish | `sidebar.messages` | Message body shows Spanish accented text |
| `l10n-es-recording` | Spanish | `sidebarConfirm` | Confirm screen shows Spanish labels |
| `l10n-es-send` | Spanish | `sidebar.messages` | Sent status shows Spanish pill |
| `l10n-fr-startup` | French | `sidebar.chats` | Chat list renders French titles |
| `l10n-fr-messages` | French | `sidebar.messages` | Message body shows French accented text |
| `l10n-fr-recording` | French | `sidebarConfirm` | Confirm screen shows French labels |
| `l10n-locale-switch` | es→fr | `sidebar.chats` | Mid-run locale switch re-renders UI |

#### 2.3 New step fields

Each step gains an optional `locale` field:

```json
{
  "name": "l10n-es-startup",
  "locale": "es",
  "target": "sidebar.chats.es",
  "input": { "kind": "command", "command": { "kind": "setLocale", "locale": "es" } },
  "expect": {
    "state": { "screen": "sidebar", "focus": "chats" },
    "renderBodyContains": ["Familia", "Proyecto Solar"]
  }
}
```

The `locale` field tells the harness to:
- Send `setLocale` before the step (if not already set)
- Look up golden files at `{stepName}.{locale}.glasses.png`
- Use locale-aware `renderBodyContains` assertions
- Track `currentLocale` in harness state

#### 2.4 Catalog validation updates

The `ui-invariants.test.ts` validator gets new rules:

- Every locale referenced in a step must have a corresponding `screens` block
- Every `renderBodyContains` needle in a locale step must be findable in the
  locale module's string values
- `glyph dsc. not found` characters (CJK ranges) must not appear in any
  Latin-script locale file
- Every locale file must have 100% key coverage (same keys as `en.ts`)

### 3. Simulator harness (`scripts/simulator-flow.mjs`)

#### 3.1 Locale tracking

Add harness-level locale state:

```javascript
let currentLocale = 'en'
const localeAwareGoldenRoot = path.join(webRoot, 'test', 'simulator-goldens')
```

#### 3.2 `setLocale` command support

Add handling in `executeStep` for `input.kind === 'command'` with
`command.kind === 'setLocale'`:

```javascript
if (input.kind === 'command' && input.command.kind === 'setLocale') {
  await sendTestCommand(input.command)
  currentLocale = input.command.locale
  return // No input to dispatch — this is a mode change, not a UI action
}
```

#### 3.3 Locale-aware golden filenames

In `validateGolden` and `captureStep`, construct golden path as:

```javascript
const goldenPath = currentLocale === 'en'
  ? path.join(goldenRoot, `${name}.glasses.png`)
  : path.join(goldenRoot, `${name}.${currentLocale}.glasses.png`)
```

English goldens use the existing naming convention (no suffix). Non-English
goldens use `{step}.{locale}.glasses.png`.

#### 3.4 Locale-aware lifecycle events

Track a new `lifecycle` event emitted by the controller when locale changes:

```javascript
} else if (event.event === 'lifecycle' && event.kind === 'localeChange') {
  currentLocale = event.locale
}
```

The controller emits this event in `resolveLocale()` when the active locale
changes.

#### 3.5 Locale-aware screen model assertions

The harness's `checkContentMatches` function needs the locale to translate
expected English needles:

**Option A** (recommended): Catalog steps with non-English locales use
locale-specific `renderBodyContains` needles directly (Spanish strings in
Spanish steps). No translation needed — the harness asserts exact locale
strings.

**Option B**: The harness maintains a locale → English translation map and
auto-translates `renderBodyContains` needles. Complex and fragile.

**Choose Option A.** Each locale step asserts against locale-specific strings.
This is what the catalog is designed for.

#### 3.6 `renderBodyContains` for locale content

The existing `renderBodyContains` check searches `JSON.stringify(model)` for
substrings. Since `summarizeScreenModel` includes `panelBody` and
`panelBodyExcerpt` (first 600 chars), Spanish/French message content is fully
searchable. The existing mechanism works unchanged — the needles are just in
a different language.

#### 3.7 Latency budget

Locale switches are no-ops (one `setLocale` command, no UI transitions). Steps
that include a locale switch + UI interaction inherit normal budgets. No
additional latency expected — locale resolution is synchronous.

### 4. Unit tests

#### 4.1 Locale module tests (`web/test/locales.test.ts`) — NEW FILE

```
describe('locale modules')
  it('en.ts has all required keys')
  it('es.ts has 100% key coverage matching en.ts')
  it('fr.ts has 100% key coverage matching en.ts')
  it('ja.ts has 100% key coverage matching en.ts') (Phase 4)
  it('ko.ts has 100% key coverage matching en.ts') (Phase 4)
  it('zh.ts has 100% key coverage matching en.ts') (Phase 4)
  it('es.ts contains no CJK characters')  // Latin-only check
  it('fr.ts contains no CJK characters')
  it('resolveLocale("es") returns Spanish module')
  it('resolveLocale("fr") returns French module')
  it('resolveLocale("unknown") falls back to English')
  it('setLocale() updates getLocale()')
```

#### 4.2 Model tests (`web/test/model.test.ts`)

Add locale-aware model tests. Each test constructs a state, sets the locale,
and asserts `screenModel(state)` output:

```
it('renders Spanish chat list with "Chats" title and accented names')
it('renders French message body with accented text')
it('renders Spanish recording status "Grabando..."')
it('renders French transcription confirm "Envoyer" / "Annuler"')
```

Use `setLocale(es)` before constructing `screenModel(state)`. No controller
needed — these are pure model tests.

#### 4.3 Controller tests (`web/test/controller.test.ts`)

Add tests for locale resolution from transcription:

```
it('sets detectedLanguage after transcribing Spanish audio')
it('resolves Spanish locale when detectedLanguage is "es"')
it('falls back to English when detectedLanguage is unsupported')
```

#### 4.4 Bridge tests (`web/test/evenBridge.test.ts`)

No locale-specific bridge behavior in Phase 1-3. The bridge passes strings
through — it does not interpret them.

For Phase 4 (CJK transliteration), add:

```
it('transliterates CJK characters to Latin in sanitizeGlassesText')
it('does not modify Latin characters in sanitizeGlassesText')
```

#### 4.5 Event mapping tests (`web/test/eventMapping.test.ts`)

No changes. Locale is a controller concern, not an input-mapping concern.

#### 4.6 Storage tests (`web/test/storage.test.ts`)

Add:

```
it('persists and restores uiLanguage from frontend config')
it('persists and restores sttLanguage from frontend config')
```

### 5. Golden screenshots

#### 5.1 Per-locale golden files

```
web/test/simulator-goldens/
  00-startup-loading.glasses.png          # English (existing)
  l10n-es-startup.es.glasses.png          # Spanish
  l10n-es-messages.es.glasses.png
  l10n-fr-startup.fr.glasses.png          # French
  l10n-fr-messages.fr.glasses.png
```

#### 5.2 Capture strategy

Golden files for non-English locales are captured with `--update-goldens` in
fixture mode. The harness uses the locale-aware path (`.es.glasses.png`) so
English goldens are never overwritten.

For Phase 4 (CJK), golden files for CJK locales validate Latin-only output
(transliteration pass). No CJK glyphs should appear in the glasses framebuffer.

#### 5.3 Blank-screenshot handling

The existing blank-screenshot path applies equally to all locales. The
simulator's LVGL rendering bug affects all locales identically — green
selection-border pixels only. The harness already handles this with the
warning-only approach from the recent review.

### 6. CJK transliteration tests (Phase 4)

#### 6.1 Fixture data

```typescript
const JA_MESSAGES: Message[] = [
  { id: 'ja-100', sender: '田中', text: 'こんにちは、元気ですか？', sentAt: '...' },
]
```

Expected transliterated output (rōmaji): `"konnichiha, genkidesuka?"`

#### 6.2 `sanitizeGlassesText` tests

```
it('transliterates hiragana to romaji')
it('transliterates katakana to romaji')
it('transliterates kanji to romaji')
it('leaves Latin text unchanged in ja locale')
it('strips CJK punctuation')
```

#### 6.3 Anti-regression: `glyph dsc. not found`

Add a catalog step that validates zero LVGL warnings when rendering
transliterated CJK content. The fixture API supplies Japanese chat names and
messages. The harness asserts zero `captureContainerFailure` events for CJK
steps — transliteration must produce only Latin glyphs.

### 7. Simulator mode support

#### 7.1 `--locale` flag

Add a `--locale` flag to `simulator-flow.mjs`:

```bash
npm run test:simulator -- --locale es   # Run Spanish sampling steps
npm run test:simulator -- --locale fr   # Run French sampling steps
npm run test:simulator -- --locale all  # Run all locale steps
npm run test:simulator                   # English only (default, unchanged)
```

The flag filters catalog steps by `step.locale`:

```javascript
if (args.locale && args.locale !== 'all') {
  catalog.steps = catalog.steps.filter(s => !s.locale || s.locale === args.locale)
}
```

English steps (no `locale` field) always run regardless of flag.

#### 7.2 Report sections

Add a "Locale coverage" section to the report:

```
## Locale coverage
| Locale | Steps | Passed | Failed | Avg ms |
| --- | ---: | ---: | ---: | ---: |
| en | 56 | 56 | 0 | 487 |
| es | 4 | 4 | 0 | 312 |
| fr | 4 | 4 | 0 | 298 |
```

### 8. Non-goals (explicitly excluded)

- **Real-device CJK rendering**: Harness cannot test real G2 hardware glyphs.
  This is manual QA.
- **Translation quality validation**: The harness checks structural rules (key
  coverage, no CJK in Latin files) but does not validate translation accuracy.
  That is human review.
- **Backend locale switching**: The backend has no locale awareness. Error
  messages from the backend are not localized in v1 — they remain English.
- **Whisper language accuracy**: The harness does not validate that Whisper
  correctly detects Japanese vs Korean. That is a Whisper model quality
  concern, not an app concern.
- **RTL layout**: Arabic and Hebrew are excluded from scope. Even Hub LVGL
  does not support RTL text containers.

### 9. Implementation order

| Order | What | Depends on | Test count added |
|---|---|---|---|
| 1 | `setLocale` fixture command + harness support | Nothing | 2 |
| 2 | Locale tracking in harness (`currentLocale`, golden paths) | #1 | 0 |
| 3 | Spanish fixture data + 4 catalog steps | #1, #2 | 8 |
| 4 | French fixture data + 4 catalog steps | #1, #2 | 8 |
| 5 | `locales.test.ts` (key coverage, structure) | `LANG_SPEC` Phase 1 | 12 |
| 6 | Model tests for Spanish/French output | `LANG_SPEC` Phase 3 | 8 |
| 7 | Controller tests for locale resolution | `LANG_SPEC` Phase 2 | 4 |
| 8 | Golden capture for es/fr steps | #3, #4 | 0 (captures) |
| 9 | CJK transliteration tests (Phase 4) | `LANG_SPEC` Phase 4 | 6 |
| 10 | `--locale` flag + report section | #2, #3, #4 | 0 |
| **Total new tests** | | | **~48** |

### 10. Verification checklist

- [ ] `npm test --prefix web` passes with all existing + new tests
- [ ] `npm run test:simulator --prefix web` still passes 56/56 English steps
- [ ] `npm run test:simulator --prefix web -- --locale es` passes Spanish steps
- [ ] `npm run test:simulator --prefix web -- --locale fr` passes French steps
- [ ] No `glyph dsc. not found` warnings in Latin-script locale steps
- [ ] `locales.test.ts` catches missing keys in any locale file
- [ ] `locales.test.ts` catches CJK characters in es/fr files
- [ ] Golden files exist for every locale step (after `--update-goldens`)
- [ ] Catalog validator accepts new `locale` field and `command` input kind
