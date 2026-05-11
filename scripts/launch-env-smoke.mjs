#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const validEnv = `STRIPE_SECRET_KEY=sk_live_launchsmoke123
STRIPE_PRICE_ID=price_launchsmoke123
STRIPE_WEBHOOK_SECRET=whsec_launchsmoke123
NOCLICK_REQUIRE_SUBSCRIPTION=true
NOCLICK_GOOGLE_OAUTH_VERIFIED=true
NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE=google-approved-2026-05-12
NOCLICK_ANDROID_RELEASE_SIGNED=true
NOCLICK_ANDROID_RELEASE_EVIDENCE=play-console-release-2026-05-12
NOCLICK_WINDOWS_CODE_SIGNED=true
NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE=authenticode-thumbprint-ABC123
`

const invalidEnv = `STRIPE_SECRET_KEY=sk_test_launchsmoke123
STRIPE_PRICE_ID=price_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
NOCLICK_REQUIRE_SUBSCRIPTION=false
NOCLICK_GOOGLE_OAUTH_VERIFIED=true
NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE=todo
NOCLICK_ANDROID_RELEASE_SIGNED=false
NOCLICK_ANDROID_RELEASE_EVIDENCE=
NOCLICK_WINDOWS_CODE_SIGNED=true
NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE=authenticode-thumbprint-ABC123
`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runApply(file) {
  const result = spawnSync(process.execPath, ['scripts/apply-launch-env.mjs', '--file', file], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

const dir = await mkdtemp(join(tmpdir(), 'noclick-launch-env-smoke-'))

try {
  const validFile = join(dir, 'valid.env')
  const invalidFile = join(dir, 'invalid.env')
  await writeFile(validFile, validEnv)
  await writeFile(invalidFile, invalidEnv)

  const valid = runApply(validFile)
  assert(valid.status === 0, `valid launch env failed:\n${valid.output}`)
  assert(valid.output.includes('READY   STRIPE_SECRET_KEY'), 'valid launch env did not mark Stripe secret ready')
  assert(valid.output.includes('Dry run only'), 'valid launch env did not remain in dry-run mode')

  const invalid = runApply(invalidFile)
  assert(invalid.status !== 0, 'invalid launch env unexpectedly passed')
  assert(invalid.output.includes('INVALID STRIPE_SECRET_KEY'), 'invalid launch env did not reject test Stripe key')
  assert(invalid.output.includes('INVALID STRIPE_PRICE_ID'), 'invalid launch env did not reject placeholder Stripe price')
  assert(invalid.output.includes('INVALID NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE'), 'invalid launch env did not reject weak Google evidence')

  console.log('Launch env smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
