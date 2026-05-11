#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputKeys = [
  'NOCLICK_GOOGLE_OAUTH_VERIFIED',
  'NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE',
  'NOCLICK_ANDROID_RELEASE_SIGNED',
  'NOCLICK_ANDROID_RELEASE_EVIDENCE',
  'NOCLICK_WINDOWS_CODE_SIGNED',
  'NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE',
]

function parseArgs(argv) {
  const args = {
    android: '',
    androidPlayConsole: '',
    windows: '',
    googleEvidence: '',
    output: '',
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--android') {
      args.android = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--android=')) {
      args.android = arg.slice('--android='.length)
      continue
    }
    if (arg === '--android-play-console') {
      args.androidPlayConsole = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--android-play-console=')) {
      args.androidPlayConsole = arg.slice('--android-play-console='.length)
      continue
    }
    if (arg === '--windows') {
      args.windows = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--windows=')) {
      args.windows = arg.slice('--windows='.length)
      continue
    }
    if (arg === '--google-evidence') {
      args.googleEvidence = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--google-evidence=')) {
      args.googleEvidence = arg.slice('--google-evidence='.length)
      continue
    }
    if (arg === '--output') {
      args.output = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length)
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function usage() {
  console.log(`Usage: npm run launch:evidence -- [options]

Builds the non-secret launch evidence env values from signed app package
evidence files and optional Google approval markers.

Options:
  --android <path>                ANDROID-SIGNING-EVIDENCE.txt from signed app artifacts.
  --android-play-console <text>   Non-secret Play Console release/review marker.
  --windows <path>                WINDOWS-SIGNING-EVIDENCE.txt from signed app artifacts.
  --google-evidence <text>        Non-secret Google OAuth verification marker.
  --output <path>                 Merge generated values into an env file.

Example:
  npm run launch:evidence -- \\
    --android artifacts/android/ANDROID-SIGNING-EVIDENCE.txt \\
    --android-play-console play-console-production-2026-05-12 \\
    --windows artifacts/windows/WINDOWS-SIGNING-EVIDENCE.txt \\
    --google-evidence google-oauth-approved-2026-05-12 \\
    --output .env.launch.local
`)
}

function readRequired(path, label) {
  const fullPath = resolve(path)
  if (!existsSync(fullPath)) throw new Error(`${label} file does not exist: ${path}`)
  return readFileSync(fullPath, 'utf8')
}

function field(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
  return match ? match[1].trim() : ''
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function hasEvidence(value) {
  const trimmed = String(value || '').trim()
  if (trimmed.length < 6) return false
  return !/(replace|example|dummy|placeholder|todo|tbd|none|null|yyyy|mm-dd|\.\.\.)/i.test(trimmed)
}

function slug(value, maxLength = 80) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
}

function compactHex(value, maxLength = 16) {
  return String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase().slice(0, maxLength)
}

function shortCommit(value) {
  return compactHex(value, 12) || 'commit-unknown'
}

function extractAndroid(content, playConsoleEvidence) {
  if (!isTrue(field(content, 'Signing required'))) {
    throw new Error('Android evidence is not from a signed required build. Re-run Build App Packages with require_signing=true.')
  }
  if (!hasEvidence(playConsoleEvidence)) {
    throw new Error('Android launch evidence also requires --android-play-console with a non-secret Play Console release/review marker.')
  }

  const releaseTag = slug(field(content, 'Release tag') || 'release-unknown', 40)
  const commit = shortCommit(field(content, 'Commit'))
  const certMatch = content.match(/certificate SHA-256 digest:\s*([a-fA-F0-9:]+)/i)
  const cert = compactHex(certMatch?.[1] || '', 16)
  const play = slug(playConsoleEvidence, 48)
  const evidence = ['android', releaseTag, commit, cert ? `cert-${cert}` : '', `play-${play}`].filter(Boolean).join('-')

  return {
    NOCLICK_ANDROID_RELEASE_SIGNED: 'true',
    NOCLICK_ANDROID_RELEASE_EVIDENCE: evidence,
  }
}

function extractWindows(content) {
  if (!isTrue(field(content, 'Signing required'))) {
    throw new Error('Windows evidence is not from a signed required build. Re-run Build App Packages with require_signing=true.')
  }
  if (field(content, 'Signature status').toLowerCase() !== 'valid') {
    throw new Error('Windows evidence does not report Signature status: Valid.')
  }

  const releaseTag = slug(field(content, 'Release tag') || 'release-unknown', 40)
  const commit = shortCommit(field(content, 'Commit'))
  const thumbprint = compactHex(field(content, 'Signer thumbprint'), 20)
  if (!thumbprint) throw new Error('Windows evidence is missing Signer thumbprint.')

  return {
    NOCLICK_WINDOWS_CODE_SIGNED: 'true',
    NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE: `windows-${releaseTag}-${commit}-thumb-${thumbprint}`,
  }
}

function googleEvidence(value) {
  if (!hasEvidence(value)) throw new Error('--google-evidence must be a non-secret approval marker.')
  return {
    NOCLICK_GOOGLE_OAUTH_VERIFIED: 'true',
    NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE: slug(value, 80),
  }
}

function serializeEnv(updates) {
  return outputKeys
    .filter((key) => Object.hasOwn(updates, key))
    .map((key) => `${key}=${updates[key]}`)
    .join('\n')
}

function mergeEnv(existing, updates) {
  const seen = new Set()
  const lines = existing.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (!match) return line
    const key = match[1]
    if (!Object.hasOwn(updates, key)) return line
    seen.add(key)
    return `${key}=${updates[key]}`
  })

  const missing = outputKeys
    .filter((key) => Object.hasOwn(updates, key) && !seen.has(key))
    .map((key) => `${key}=${updates[key]}`)

  if (!missing.length) return lines.join('\n')
  const spacer = lines.length && lines[lines.length - 1].trim() ? [''] : []
  return [...lines, ...spacer, '# Launch evidence generated by npm run launch:evidence', ...missing].join('\n')
}

async function main() {
  const args = parseArgs(process.argv)
  const updates = {}

  if (args.googleEvidence) Object.assign(updates, googleEvidence(args.googleEvidence))
  if (args.android) Object.assign(updates, extractAndroid(readRequired(args.android, 'Android evidence'), args.androidPlayConsole))
  if (args.windows) Object.assign(updates, extractWindows(readRequired(args.windows, 'Windows evidence')))

  if (!Object.keys(updates).length) {
    usage()
    throw new Error('No launch evidence inputs were provided.')
  }

  const envText = serializeEnv(updates)
  if (args.output) {
    const outputPath = resolve(args.output)
    const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
    await writeFile(outputPath, `${mergeEnv(existing, updates).replace(/\s+$/, '')}\n`)
    console.log(`Wrote launch evidence values to ${args.output}`)
  } else {
    console.log(envText)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
