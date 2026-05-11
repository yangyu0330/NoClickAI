#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const completeSecrets = `ANDROID_KEYSTORE_BASE64\t2026-05-12T00:00:00Z
ANDROID_KEYSTORE_PASSWORD\t2026-05-12T00:00:00Z
ANDROID_KEY_ALIAS\t2026-05-12T00:00:00Z
ANDROID_KEY_PASSWORD\t2026-05-12T00:00:00Z
WINDOWS_CSC_LINK\t2026-05-12T00:00:00Z
WINDOWS_CSC_KEY_PASSWORD\t2026-05-12T00:00:00Z
`

const missingSecrets = `ANDROID_KEYSTORE_BASE64\t2026-05-12T00:00:00Z
WINDOWS_CSC_LINK\t2026-05-12T00:00:00Z
`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runPreflight(args) {
  const result = spawnSync(process.execPath, ['scripts/release-signing-preflight.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

const dir = await mkdtemp(join(tmpdir(), 'noclick-signing-preflight-smoke-'))

try {
  const completePath = join(dir, 'complete.txt')
  const missingPath = join(dir, 'missing.txt')
  await writeFile(completePath, completeSecrets)
  await writeFile(missingPath, missingSecrets)

  const ready = runPreflight(['--repo', 'owner/repo', '--secret-list-file', completePath])
  assert(ready.status === 0, `complete secret list failed:\n${ready.output}`)
  assert(ready.output.includes('READY   Android signed APK/AAB'), 'Android group was not ready')
  assert(ready.output.includes('READY   Windows Authenticode installer'), 'Windows group was not ready')

  const missing = runPreflight(['--repo', 'owner/repo', '--secret-list-file', missingPath])
  assert(missing.status !== 0, 'missing secret list unexpectedly passed in strict mode')
  assert(missing.output.includes('ANDROID_KEYSTORE_PASSWORD'), 'missing Android password was not reported')
  assert(missing.output.includes('WINDOWS_CSC_KEY_PASSWORD'), 'missing Windows password was not reported')

  const json = runPreflight(['--repo', 'owner/repo', '--secret-list-file', missingPath, '--json', '--no-strict'])
  assert(json.status === 0, `json no-strict failed:\n${json.output}`)
  const report = JSON.parse(json.output)
  assert(report.ok === false, 'json report should not be ok')
  assert(report.missing.includes('ANDROID_KEY_ALIAS'), 'json report missing ANDROID_KEY_ALIAS')

  console.log('Release signing preflight smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
