#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_ENV_FILE = '.env.launch.local'
const DEFAULT_BASE_URL = 'https://noclickai-zeta.vercel.app'
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]

function parseArgs(argv) {
  const args = {
    file: process.env.NOCLICK_STRIPE_LAUNCH_ENV_FILE || DEFAULT_ENV_FILE,
    output: process.env.NOCLICK_STRIPE_LAUNCH_OUTPUT || '',
    apply: envFlag(process.env.NOCLICK_STRIPE_LAUNCH_APPLY),
    allowTestKey: envFlag(process.env.NOCLICK_STRIPE_ALLOW_TEST_KEY),
    productName: process.env.NOCLICK_STRIPE_PRODUCT_NAME || 'NoClick AI Pro',
    lookupKey: process.env.NOCLICK_STRIPE_LOOKUP_KEY || 'noclickai_pro_monthly',
    amount: Number(process.env.NOCLICK_STRIPE_UNIT_AMOUNT || 9900),
    currency: process.env.NOCLICK_STRIPE_CURRENCY || 'usd',
    interval: process.env.NOCLICK_STRIPE_INTERVAL || 'month',
    baseUrl: process.env.NOCLICK_SERVER_BASE_URL || process.env.NOCLICK_PUBLIC_APP_URL || DEFAULT_BASE_URL,
    webhookUrl: process.env.NOCLICK_STRIPE_WEBHOOK_URL || '',
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--file') {
      args.file = argv[index + 1] || args.file
      index += 1
      continue
    }
    if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length)
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
    if (arg === '--apply') {
      args.apply = true
      continue
    }
    if (arg === '--dry-run') {
      args.apply = false
      continue
    }
    if (arg === '--allow-test-key') {
      args.allowTestKey = true
      continue
    }
    if (arg === '--product-name') {
      args.productName = argv[index + 1] || args.productName
      index += 1
      continue
    }
    if (arg.startsWith('--product-name=')) {
      args.productName = arg.slice('--product-name='.length)
      continue
    }
    if (arg === '--lookup-key') {
      args.lookupKey = argv[index + 1] || args.lookupKey
      index += 1
      continue
    }
    if (arg.startsWith('--lookup-key=')) {
      args.lookupKey = arg.slice('--lookup-key='.length)
      continue
    }
    if (arg === '--amount') {
      args.amount = Number(argv[index + 1] || args.amount)
      index += 1
      continue
    }
    if (arg.startsWith('--amount=')) {
      args.amount = Number(arg.slice('--amount='.length))
      continue
    }
    if (arg === '--currency') {
      args.currency = argv[index + 1] || args.currency
      index += 1
      continue
    }
    if (arg.startsWith('--currency=')) {
      args.currency = arg.slice('--currency='.length)
      continue
    }
    if (arg === '--interval') {
      args.interval = argv[index + 1] || args.interval
      index += 1
      continue
    }
    if (arg.startsWith('--interval=')) {
      args.interval = arg.slice('--interval='.length)
      continue
    }
    if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || args.baseUrl
      index += 1
      continue
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length)
      continue
    }
    if (arg === '--webhook-url') {
      args.webhookUrl = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--webhook-url=')) {
      args.webhookUrl = arg.slice('--webhook-url='.length)
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  args.currency = args.currency.toLowerCase()
  args.interval = args.interval.toLowerCase()
  args.baseUrl = args.baseUrl.replace(/\/+$/, '')
  args.webhookUrl = args.webhookUrl || `${args.baseUrl}/v1/billing/webhook`
  args.output = args.output || args.file
  return args
}

function usage() {
  console.log(`Usage: npm run launch:stripe -- [options]

Creates the Stripe recurring Price and webhook endpoint required for public
launch, then merges STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET into the launch env
file. It never prints secret values.

Options:
  --file <path>          Env file containing STRIPE_SECRET_KEY. Default: ${DEFAULT_ENV_FILE}
  --output <path>        Env file to update. Default: same as --file
  --apply                Call Stripe. Without this, only validate and print the plan.
  --product-name <name>  Stripe product name. Default: NoClick AI Pro
  --lookup-key <key>     Stripe Price lookup key. Default: noclickai_pro_monthly
  --amount <minor>       Price amount in minor currency units. Default: 9900
  --currency <code>      ISO currency code. Default: usd
  --interval <period>    day, week, month, or year. Default: month
  --base-url <url>       App/API base URL for webhook. Default: ${DEFAULT_BASE_URL}
  --webhook-url <url>    Explicit Stripe webhook URL.
  --allow-test-key       Allow sk_test_ for non-production dry-runs.
`)
}

function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function parseDotenv(path) {
  if (!existsSync(path)) return {}
  const env = {}
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      let line = rawLine.trim()
      if (!line || line.startsWith('#')) return
      if (line.startsWith('export ')) line = line.slice('export '.length).trim()
      const equals = line.indexOf('=')
      if (equals === -1) throw new Error(`${path}:${index + 1} is not KEY=value`)
      const key = line.slice(0, equals).trim()
      let value = line.slice(equals + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    })
  return env
}

function validate(args, env) {
  const secretKey = process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || ''
  if (!secretKey) throw new Error(`STRIPE_SECRET_KEY is missing. Put it in ${args.file} or the process environment.`)
  if (!args.allowTestKey && !secretKey.startsWith('sk_live_')) throw new Error('STRIPE_SECRET_KEY must start with sk_live_ for launch setup.')
  if (args.allowTestKey && !(secretKey.startsWith('sk_live_') || secretKey.startsWith('sk_test_'))) throw new Error('STRIPE_SECRET_KEY must start with sk_live_ or sk_test_.')
  if (!Number.isInteger(args.amount) || args.amount <= 0) throw new Error('--amount must be a positive integer in minor currency units.')
  if (!/^[a-z]{3}$/.test(args.currency)) throw new Error('--currency must be a 3-letter lowercase ISO currency code.')
  if (!['day', 'week', 'month', 'year'].includes(args.interval)) throw new Error('--interval must be one of day, week, month, or year.')
  if (!/^https:\/\//.test(args.webhookUrl)) throw new Error('--webhook-url must use HTTPS.')
  if (!args.productName.trim()) throw new Error('--product-name is required.')
  if (!args.lookupKey.trim()) throw new Error('--lookup-key is required.')
  return secretKey
}

function formBody(entries) {
  const body = new URLSearchParams()
  Object.entries(entries).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((entry) => body.append(key, entry))
    } else {
      body.append(key, String(value))
    }
  })
  return body
}

async function stripeRequest(secretKey, path, body, idempotencyKey) {
  if (process.env.NOCLICK_STRIPE_SETUP_MOCK_LOG) {
    appendFileSync(process.env.NOCLICK_STRIPE_SETUP_MOCK_LOG, `${JSON.stringify({
      path,
      idempotencyKey,
      body: Object.fromEntries(body.entries()),
    })}\n`)
    if (path === '/v1/prices') return { id: 'price_mock_launch_123' }
    if (path === '/v1/webhook_endpoints') return { id: 'we_mock_launch_123', secret: 'whsec_mock_launch_123' }
    throw new Error(`Unhandled mock Stripe path: ${path}`)
  }

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload.error?.message || JSON.stringify(payload).slice(0, 300)
    throw new Error(`Stripe ${path} returned HTTP ${response.status}: ${message}`)
  }
  return payload
}

function safeKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 180)
}

async function createStripeLaunchObjects(args, secretKey) {
  const price = await stripeRequest(
    secretKey,
    '/v1/prices',
    formBody({
      currency: args.currency,
      unit_amount: args.amount,
      'recurring[interval]': args.interval,
      'product_data[name]': args.productName,
      lookup_key: args.lookupKey,
      transfer_lookup_key: 'true',
      'metadata[app]': 'noclickai',
      'metadata[purpose]': 'public_launch',
    }),
    `noclickai-price-${safeKey(args.lookupKey)}-${args.currency}-${args.amount}-${args.interval}`,
  )
  if (!String(price.id || '').startsWith('price_')) throw new Error('Stripe price creation did not return a price_ id.')

  const webhook = await stripeRequest(
    secretKey,
    '/v1/webhook_endpoints',
    formBody({
      url: args.webhookUrl,
      'enabled_events[]': WEBHOOK_EVENTS,
      description: 'NoClick AI billing webhook',
      'metadata[app]': 'noclickai',
      'metadata[purpose]': 'public_launch',
    }),
    `noclickai-webhook-${safeKey(args.webhookUrl)}`,
  )
  if (!String(webhook.secret || '').startsWith('whsec_')) throw new Error('Stripe webhook creation did not return a whsec_ secret.')

  return {
    STRIPE_PRICE_ID: price.id,
    STRIPE_WEBHOOK_SECRET: webhook.secret,
    NOCLICK_REQUIRE_SUBSCRIPTION: 'true',
  }
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
  const missing = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${value}`)
  if (!missing.length) return lines.join('\n')
  const spacer = lines.length && lines[lines.length - 1].trim() ? [''] : []
  return [...lines, ...spacer, '# Stripe launch values generated by npm run launch:stripe', ...missing].join('\n')
}

async function writeOutput(path, updates) {
  const fullPath = resolve(path)
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
  await writeFile(fullPath, `${mergeEnv(existing, updates).replace(/\s+$/, '')}\n`)
}

async function main() {
  const args = parseArgs(process.argv)
  const filePath = resolve(args.file)
  const env = parseDotenv(filePath)
  const secretKey = validate(args, env)

  console.log('Stripe launch setup plan:')
  console.log(`- product: ${args.productName}`)
  console.log(`- price: ${args.amount} ${args.currency.toUpperCase()} / ${args.interval}`)
  console.log(`- webhook: ${args.webhookUrl}`)
  console.log(`- events: ${WEBHOOK_EVENTS.join(', ')}`)

  if (!args.apply) {
    console.log('\nDry run only. Re-run with --apply to create Stripe objects and update the env file.')
    return
  }

  const updates = await createStripeLaunchObjects(args, secretKey)
  if (process.env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY) updates.STRIPE_SECRET_KEY = secretKey
  await writeOutput(args.output, updates)
  console.log(`Wrote Stripe launch values to ${args.output}`)
  console.log(`Created Stripe price ${updates.STRIPE_PRICE_ID}; webhook secret stored without printing.`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
