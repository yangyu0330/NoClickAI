#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeCommit = 'feedfacefeedfacefeedfacefeedfacefeedface'

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

function runApply(file, extraArgs = [], env = process.env) {
  const result = spawnSync(process.execPath, ['scripts/apply-launch-env.mjs', '--file', file, ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

async function readCommandLog(logPath) {
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function assertApplyMode(validFile, dir) {
  const logPath = join(dir, 'commands.log')
  await writeFile(logPath, '')

  const env = {
    ...process.env,
    NOCLICK_LAUNCH_ENV_COMMAND_LOG: logPath,
    NOCLICK_LAUNCH_ENV_FAKE_COMMIT: fakeCommit,
  }

  const applied = runApply(validFile, ['--apply', '--deploy', '--verify', '--strict'], env)
  assert(applied.status === 0, `apply-mode launch env failed:\n${applied.output}`)
  assert(applied.output.includes('APPLY   STRIPE_SECRET_KEY'), 'apply mode did not report applying Stripe secret')
  assert(!applied.output.includes('sk_live_launchsmoke123'), 'apply mode printed the Stripe secret value')

  const entries = await readCommandLog(logPath)
  const envAdds = entries.filter((entry) => (
    entry.command.endsWith('npx') ||
    entry.command.endsWith('npx.cmd')
  ) && entry.args[0] === 'vercel@latest' && entry.args[1] === 'env' && entry.args[2] === 'add')

  assert(envAdds.length === 10, `expected 10 Vercel env add calls, got ${envAdds.length}`)
  assert(envAdds.every((entry) => entry.args.includes('production')), 'an env add call did not target production')
  assert(envAdds.every((entry) => entry.args.includes('--force') && entry.args.includes('--yes')), 'env add calls must be non-interactive and forced')
  assert(envAdds.every((entry) => entry.stdinLength > 0), 'env add calls did not receive stdin values')

  const deploy = entries.find((entry) => (
    entry.command.endsWith('npx') ||
    entry.command.endsWith('npx.cmd')
  ) && entry.args.includes('deploy'))
  assert(deploy, 'apply mode did not call Vercel deploy')
  assert(deploy.args.includes(`NOCLICK_COMMIT_SHA=${fakeCommit}`), 'deploy did not receive the fake commit SHA')

  const npmRuns = entries.filter((entry) => entry.command.endsWith('npm') || entry.command.endsWith('npm.cmd'))
  assert(npmRuns.some((entry) => entry.args.includes('launch:status')), 'apply mode did not run launch:status')
  assert(npmRuns.some((entry) => entry.args.includes('audit:production')), 'apply mode did not run audit:production')
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

  await assertApplyMode(validFile, dir)

  console.log('Launch env smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
