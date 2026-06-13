/**
 * Translate missing locale keys using agy CLI.
 * Usage: node scripts/translate-locales.mjs [locale...]
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const LOCALES_DIR = join(import.meta.dirname, '..', 'web', 'src', 'locales')
const EN_PATH = join(LOCALES_DIR, 'en.ts')
const BATCH = 25

const LANG_NAMES = {
  da: 'Danish', fi: 'Finnish', hu: 'Hungarian', id: 'Indonesian',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', ms: 'Malay',
  nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese',
  ro: 'Romanian', sk: 'Slovak', sv: 'Swedish', tr: 'Turkish',
  vi: 'Vietnamese', zh: 'Chinese (Simplified)',
}

function parseEn() {
  const content = readFileSync(EN_PATH, 'utf8')
  const lines = content.split('\n')
  const pairs = []
  for (const line of lines) {
    const m = line.match(/^\s+(\w+):\s*['"`](.+)['"`],?$/)
    if (!m || m[1] === '_cjkTransliterate') continue
    pairs.push({ key: m[1], value: m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n') })
  }
  return pairs
}

function parseLocale(path) {
  const content = readFileSync(path, 'utf8')
  const keys = new Set()
  for (const line of content.split('\n')) {
    const m = line.match(/^\s+(\w+):/)
    if (m) keys.add(m[1])
  }
  return { content, keys }
}

function translateBatch(batch, langName) {
  const obj = Object.fromEntries(batch.map(p => [p.key, p.value]))
  const prompt = `Translate these English UI strings to ${langName}. Return ONLY a valid JSON object with exactly the same keys, with ${langName} translations as values. No other text.\n${JSON.stringify(obj)}`
  
  const output = execFileSync('agy', ['-p', prompt, '--print-timeout', '3m'], {
    encoding: 'utf8',
    timeout: 240_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  
  // Parse JSON from output (may have surrounding text)
  const jsonMatch = output.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in output: ${output.slice(0, 200)}`)
  return JSON.parse(jsonMatch[0])
}

async function translateLocale(localeFile) {
  const lang = localeFile.replace('.ts', '')
  const langName = LANG_NAMES[lang]
  if (!langName) {
    console.log(`  ${lang}: unknown language, skipping`)
    return
  }

  const enPairs = parseEn()
  const localePath = join(LOCALES_DIR, localeFile)
  const { keys: existingKeys, content } = parseLocale(localePath)

  const missing = enPairs.filter(p => !existingKeys.has(p.key))
  if (missing.length === 0) {
    console.log(`  ${lang}: no missing keys (${existingKeys.size} present)`)
    return
  }

  console.log(`  ${lang}: translating ${missing.length} missing keys in batches of ${BATCH}...`)

  // Translate in batches
  const translations = {}
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    try {
      const result = translateBatch(batch, langName)
      Object.assign(translations, result)
      process.stdout.write(`    batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(missing.length / BATCH)}: ${Object.keys(result).length} keys\n`)
    } catch (e) {
      console.error(`    batch ${Math.floor(i / BATCH) + 1}: FAILED - ${e.message}`)
      // Continue with next batch
    }
  }

  const succeeded = Object.keys(translations)
  if (succeeded.length === 0) {
    console.log(`  ${lang}: all batches failed, skipping`)
    return
  }

  console.log(`  ${lang}: got ${succeeded.length}/${missing.length} translations`)

  // Insert into file after last existing key
  const lines = content.split('\n')
  const lastKeyLine = lines.reduce((best, line, i) => {
    return /^\s+\w+:\s/.test(line) ? i : best
  }, -1)

  const indent = lines[lastKeyLine].match(/^(\s+)/)[1]
  const insertLines = succeeded.map(
    key => `${indent}${key}: '${translations[key].replace(/'/g, "\\'")}',`
  )

  lines.splice(lastKeyLine + 1, 0, ...insertLines)
  writeFileSync(localePath, lines.join('\n'), 'utf8')
  console.log(`  ${lang}: wrote ${succeeded.length} translations`)
}

function main() {
  const args = process.argv.slice(2)
  const enPairs = parseEn()
  console.log(`en.ts has ${enPairs.length} keys\n`)

  const done = new Set(['es', 'de', 'fr', 'ca', 'cs'])
  let localeFiles = readdirSync(LOCALES_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'en.ts' && f !== 'index.ts' && !done.has(f.replace('.ts', '')))
    .sort()

  if (args.length > 0) {
    localeFiles = localeFiles.filter(f => args.includes(f.replace('.ts', '')))
  }

  for (const file of localeFiles) {
    translateLocale(file)
  }

  console.log('\nDone.')
}

main()
