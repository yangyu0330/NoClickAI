#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const signedAndroidEvidence = `NoClick AI Android signing evidence
Release tag: v1.2.3
Commit: abcdef1234567890abcdef1234567890abcdef12
Signing required: true
Generated at: 2026-05-12T00:00:00Z

APK: NoClickAI-Android-v1.2.3.apk
Signer #1 certificate SHA-256 digest: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99

AAB: NoClickAI-Android-v1.2.3.aab
jar verified.
`

const signedWindowsEvidence = `NoClick AI Windows signing evidence
Release tag: v1.2.3
Commit: abcdef1234567890abcdef1234567890abcdef12
Signing required: true
Generated at: 2026-05-12T00:00:00Z

Installer: NoClickAI-Windows-Setup-v1.2.3.exe
Signature status: Valid
Signer subject: CN=NoClick AI
Signer thumbprint: 11223344556677889900AABBCCDDEEFF00112233
`

const unsignedAndroidEvidence = `NoClick AI Android signing evidence
Release tag: v1.2.3
Commit: abcdef1234567890abcdef1234567890abcdef12
Signing required: false
Status: skipped for unsigned internal package testing
`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runEvidence(args) {
  const result = spawnSync(process.execPath, ['scripts/collect-launch-evidence.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

const dir = await mkdtemp(join(tmpdir(), 'noclick-launch-evidence-smoke-'))

try {
  const androidPath = join(dir, 'ANDROID-SIGNING-EVIDENCE.txt')
  const windowsPath = join(dir, 'WINDOWS-SIGNING-EVIDENCE.txt')
  const unsignedAndroidPath = join(dir, 'ANDROID-UNSIGNED.txt')
  const outputPath = join(dir, '.env.launch.local')

  await writeFile(androidPath, signedAndroidEvidence)
  await writeFile(windowsPath, signedWindowsEvidence)
  await writeFile(unsignedAndroidPath, unsignedAndroidEvidence)
  await writeFile(outputPath, 'STRIPE_SECRET_KEY=sk_live_existing\nNOCLICK_ANDROID_RELEASE_SIGNED=false\n')

  const collected = runEvidence([
    '--android',
    androidPath,
    '--android-play-console',
    'play-console-production-2026-05-12',
    '--windows',
    windowsPath,
    '--google-evidence',
    'google-oauth-approved-2026-05-12',
    '--output',
    outputPath,
  ])
  assert(collected.status === 0, `signed launch evidence failed:\n${collected.output}`)

  const output = await readFile(outputPath, 'utf8')
  assert(output.includes('STRIPE_SECRET_KEY=sk_live_existing'), 'merge removed existing Stripe value')
  assert(output.includes('NOCLICK_GOOGLE_OAUTH_VERIFIED=true'), 'missing Google verified flag')
  assert(output.includes('NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE=google-oauth-approved-2026-05-12'), 'missing Google evidence')
  assert(output.includes('NOCLICK_ANDROID_RELEASE_SIGNED=true'), 'missing Android signed flag')
  assert(output.includes('NOCLICK_ANDROID_RELEASE_EVIDENCE=android-v1.2.3-abcdef123456-cert-aabbccddeeff0011-play-play-console-production-2026-05-12'), 'missing Android evidence marker')
  assert(output.includes('NOCLICK_WINDOWS_CODE_SIGNED=true'), 'missing Windows signed flag')
  assert(output.includes('NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE=windows-v1.2.3-abcdef123456-thumb-11223344556677889900'), 'missing Windows evidence marker')

  const unsigned = runEvidence([
    '--android',
    unsignedAndroidPath,
    '--android-play-console',
    'play-console-production-2026-05-12',
  ])
  assert(unsigned.status !== 0, 'unsigned Android evidence unexpectedly passed')
  assert(unsigned.output.includes('require_signing=true'), 'unsigned Android failure did not explain require_signing=true')

  const missingPlay = runEvidence(['--android', androidPath])
  assert(missingPlay.status !== 0, 'Android evidence without Play Console marker unexpectedly passed')
  assert(missingPlay.output.includes('--android-play-console'), 'missing Play Console marker failure did not explain required option')

  console.log('Launch evidence smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
