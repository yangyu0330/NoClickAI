#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function runStripe(args, env = process.env) {
  const result = spawnSync(process.execPath, ['scripts/setup-stripe-launch.mjs', ...args], {
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

const dir = await mkdtemp(join(tmpdir(), 'noclick-stripe-launch-smoke-'))

try {
  const envPath = join(dir, '.env.launch.local')
  const logPath = join(dir, 'stripe.log')
  await writeFile(envPath, 'STRIPE_SECRET_KEY=sk_live_smoke123\nSTRIPE_PRICE_ID=price_old\n')
  await writeFile(logPath, '')

  const dryRun = runStripe(['--file', envPath, '--amount', '1234', '--currency', 'usd', '--interval', 'month', '--base-url', 'https://noclickai-zeta.vercel.app'])
  assert(dryRun.status === 0, `dry-run failed:\n${dryRun.output}`)
  assert(dryRun.output.includes('Dry run only'), 'dry-run did not stay non-mutating')
  assert(!dryRun.output.includes('sk_live_smoke123'), 'dry-run printed the Stripe secret')

  const applied = runStripe(
    ['--file', envPath, '--apply', '--amount', '1234', '--currency', 'usd', '--interval', 'month', '--base-url', 'https://noclickai-zeta.vercel.app'],
    {
      ...process.env,
      NOCLICK_STRIPE_SETUP_MOCK_LOG: logPath,
    },
  )
  assert(applied.status === 0, `apply failed:\n${applied.output}`)
  assert(applied.output.includes('Created Stripe price price_mock_launch_123'), 'apply did not report the mock price id')
  assert(!applied.output.includes('whsec_mock_launch_123'), 'apply printed the webhook secret')

  const output = await readFile(envPath, 'utf8')
  assert(output.includes('STRIPE_SECRET_KEY=sk_live_smoke123'), 'env merge removed the Stripe secret')
  assert(output.includes('STRIPE_PRICE_ID=price_mock_launch_123'), 'env merge did not update STRIPE_PRICE_ID')
  assert(output.includes('STRIPE_WEBHOOK_SECRET=whsec_mock_launch_123'), 'env merge did not write STRIPE_WEBHOOK_SECRET')
  assert(output.includes('NOCLICK_REQUIRE_SUBSCRIPTION=true'), 'env merge did not enable subscription enforcement')

  const calls = (await readFile(logPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  assert(calls.length === 2, `expected 2 Stripe calls, got ${calls.length}`)
  assert(calls[0].path === '/v1/prices', 'first Stripe call should create a price')
  assert(calls[0].body['recurring[interval]'] === 'month', 'price call did not include recurring interval')
  assert(calls[0].body['product_data[name]'] === 'NoClick AI Pro', 'price call did not include product_data name')
  assert(calls[1].path === '/v1/webhook_endpoints', 'second Stripe call should create a webhook endpoint')
  assert(calls[1].body.url === 'https://noclickai-zeta.vercel.app/v1/billing/webhook', 'webhook call used the wrong URL')
  assert(calls[1].body['enabled_events[]'] === 'invoice.payment_failed', 'webhook body did not include expected repeated enabled_events')

  const testKey = join(dir, 'test-key.env')
  await writeFile(testKey, 'STRIPE_SECRET_KEY=sk_test_smoke123\n')
  const rejected = runStripe(['--file', testKey, '--apply'])
  assert(rejected.status !== 0, 'test key unexpectedly passed without --allow-test-key')
  assert(rejected.output.includes('sk_live_'), 'test-key failure did not explain live key requirement')

  console.log('Stripe launch smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
