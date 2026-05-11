#!/usr/bin/env node

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOST = '127.0.0.1'
const PORT = Number(process.env.NOCLICK_BILLING_SMOKE_PORT || 58991 + Math.floor(Math.random() * 500))
const BASE_URL = `http://${HOST}:${PORT}`
const WEBHOOK_SECRET = 'whsec_local_billing_smoke_secret'
const PASSWORD = 'billing-smoke-password'

const tempDir = await mkdtemp(join(tmpdir(), 'noclick-billing-smoke-'))
const serverOutput = []
let server = null
let shuttingDown = false

function rememberOutput(chunk) {
  const text = chunk.toString()
  serverOutput.push(text)
  if (serverOutput.join('').length > 20_000) serverOutput.shift()
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  if (server && !server.killed) server.kill()
}

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function stripeSignature(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${timestamp}.${rawBody}`
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

async function waitForServer() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break
    try {
      const { response, body } = await fetchJson('/health')
      if (response.ok && body.ok) return body
    } catch {
      // Keep polling until the server is ready or exits.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  fail(`server did not start. Output:\n${serverOutput.join('')}`)
}

async function signedWebhook(event) {
  const rawBody = JSON.stringify(event)
  return fetchJson('/v1/billing/webhook', {
    method: 'POST',
    headers: { 'Stripe-Signature': stripeSignature(rawBody) },
    body: rawBody,
  })
}

async function main() {
  const env = {
    ...process.env,
    HOST,
    PORT: String(PORT),
    NOCLICK_SYNC_DATA_DIR: tempDir,
    NOCLICK_SYNC_TOKEN: 'billing-smoke-sync-token-that-is-not-for-production',
    NOCLICK_TOKEN_ENCRYPTION_KEY: 'billing-smoke-token-encryption-key',
    NOCLICK_PUBLIC_APP_URL: BASE_URL,
    NOCLICK_SERVER_BASE_URL: BASE_URL,
    NOCLICK_ALLOWED_ORIGIN: BASE_URL,
    NOCLICK_ADMIN_EMAILS: 'billing-smoke-admin@example.com',
    NOCLICK_REQUIRE_SUBSCRIPTION: 'true',
    NOCLICK_EXPOSE_ERROR_DETAILS: 'false',
    DATABASE_URL: '',
    POSTGRES_URL: '',
    STRIPE_SECRET_KEY: 'sk_test_local_billing_smoke',
    STRIPE_PRICE_ID: 'price_local_billing_smoke',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    OPENAI_API_KEY: '',
    NOCLICK_OPENAI_MODEL: 'gpt-5-nano',
  }

  server = spawn(process.execPath, ['server/sync-server.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', rememberOutput)
  server.stderr.on('data', rememberOutput)

  try {
    const health = await waitForServer()
    assert(health.requireSubscription === true, '/health did not enable subscription enforcement')
    assert(health.stripeConfigured === true, '/health did not report Stripe checkout configured')
    assert(health.stripeWebhookConfigured === true, '/health did not report Stripe webhook configured')

    const email = `billing-smoke-${crypto.randomBytes(8).toString('hex')}@example.com`
    const register = await fetchJson('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, name: 'Billing Smoke' }),
    })
    assert(register.response.status === 201, `/v1/auth/register returned HTTP ${register.response.status}`)
    const token = register.body.token
    const userId = register.body.user?.id
    assert(token && userId, '/v1/auth/register did not return a token and user id')
    const authHeaders = { Authorization: `Bearer ${token}` }

    const blockedReadiness = await fetchJson('/v1/readiness', { headers: authHeaders })
    assert(blockedReadiness.response.status === 402, 'free account was not blocked when subscription enforcement is enabled')

    const unsignedWebhook = await fetchJson('/v1/billing/webhook', {
      method: 'POST',
      body: JSON.stringify({ id: 'evt_unsigned', type: 'checkout.session.completed', data: { object: {} } }),
    })
    assert(unsignedWebhook.response.status === 400, 'unsigned Stripe webhook was not rejected')
    assert(unsignedWebhook.body.error === 'invalid_stripe_signature', `unexpected unsigned webhook error: ${unsignedWebhook.body.error}`)

    const checkoutEvent = {
      id: `evt_checkout_${crypto.randomBytes(8).toString('hex')}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${crypto.randomBytes(8).toString('hex')}`,
          client_reference_id: userId,
          customer: `cus_${crypto.randomBytes(8).toString('hex')}`,
          subscription: `sub_${crypto.randomBytes(8).toString('hex')}`,
          payment_status: 'paid',
          status: 'complete',
          metadata: { userId },
        },
      },
    }

    const completed = await signedWebhook(checkoutEvent)
    assert(completed.response.ok, `/v1/billing/webhook checkout event returned HTTP ${completed.response.status}`)
    assert(completed.body.userId === userId, 'checkout webhook did not resolve the local user')

    const duplicate = await signedWebhook(checkoutEvent)
    assert(duplicate.response.ok, 'duplicate checkout webhook did not return ok')
    assert(duplicate.body.duplicate === true, 'duplicate checkout webhook was not marked duplicate')

    const paidStatus = await fetchJson('/v1/billing/status', { headers: authHeaders })
    assert(paidStatus.response.ok, `/v1/billing/status returned HTTP ${paidStatus.response.status}`)
    assert(paidStatus.body.user?.billingPlan === 'pro', `expected billingPlan=pro, got ${paidStatus.body.user?.billingPlan}`)
    assert(paidStatus.body.user?.subscriptionStatus === 'active', `expected subscriptionStatus=active, got ${paidStatus.body.user?.subscriptionStatus}`)

    const allowedReadiness = await fetchJson('/v1/readiness', { headers: authHeaders })
    assert(allowedReadiness.response.ok, `paid account readiness returned HTTP ${allowedReadiness.response.status}`)

    const deleteEvent = {
      id: `evt_deleted_${crypto.randomBytes(8).toString('hex')}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: checkoutEvent.data.object.subscription,
          customer: checkoutEvent.data.object.customer,
          status: 'canceled',
        },
      },
    }

    const deleted = await signedWebhook(deleteEvent)
    assert(deleted.response.ok, `/v1/billing/webhook deleted event returned HTTP ${deleted.response.status}`)
    assert(deleted.body.userId === userId, 'subscription deletion webhook did not resolve the local user')

    const canceledStatus = await fetchJson('/v1/billing/status', { headers: authHeaders })
    assert(canceledStatus.body.user?.billingPlan === 'free', `expected billingPlan=free, got ${canceledStatus.body.user?.billingPlan}`)
    assert(
      canceledStatus.body.user?.subscriptionStatus === 'canceled',
      `expected subscriptionStatus=canceled, got ${canceledStatus.body.user?.subscriptionStatus}`,
    )

    const blockedAgain = await fetchJson('/v1/readiness', { headers: authHeaders })
    assert(blockedAgain.response.status === 402, 'canceled account was not blocked by subscription enforcement')

    await fetchJson('/v1/auth/delete-account', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirmEmail: email }),
    })

    console.log(`Billing webhook smoke passed: ${BASE_URL}`)
  } finally {
    shutdown()
    await new Promise((resolve) => setTimeout(resolve, 250))
    await rm(tempDir, { recursive: true, force: true })
  }
}

await main()
