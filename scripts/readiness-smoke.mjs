#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PUBLIC_APP_URL = process.env.NOCLICK_READINESS_SMOKE_PUBLIC_URL || 'https://noclickai-zeta.vercel.app'
const PASSWORD = 'readiness-smoke-password'

const cases = [
  {
    name: 'baseline launch blockers',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://noclickai-zeta.vercel.app/v1/connectors/google/callback',
    },
    expected: {
      GOOGLE_REDIRECT_URI: 'ready',
      GOOGLE_OAUTH_VERIFICATION: 'manual',
      ANDROID_RELEASE_SIGNING: 'manual',
      WINDOWS_CODE_SIGNING: 'manual',
      STRIPE_SECRET_KEY: 'missing',
    },
  },
  {
    name: 'manual flags require evidence',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://noclickai-zeta.vercel.app/v1/connectors/google/callback',
      NOCLICK_GOOGLE_OAUTH_VERIFIED: 'true',
      NOCLICK_ANDROID_RELEASE_SIGNED: 'true',
      NOCLICK_WINDOWS_CODE_SIGNED: 'true',
    },
    expected: {
      GOOGLE_OAUTH_VERIFICATION: 'manual',
      ANDROID_RELEASE_SIGNING: 'manual',
      WINDOWS_CODE_SIGNING: 'manual',
    },
  },
  {
    name: 'manual evidence unlocks attestation',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://noclickai-zeta.vercel.app/v1/connectors/google/callback',
      NOCLICK_GOOGLE_OAUTH_VERIFIED: 'true',
      NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE: 'readiness-smoke-google',
      NOCLICK_ANDROID_RELEASE_SIGNED: 'true',
      NOCLICK_ANDROID_RELEASE_EVIDENCE: 'readiness-smoke-android',
      NOCLICK_WINDOWS_CODE_SIGNED: 'true',
      NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE: 'readiness-smoke-windows',
    },
    expected: {
      GOOGLE_OAUTH_VERIFICATION: 'ready',
      ANDROID_RELEASE_SIGNING: 'ready',
      WINDOWS_CODE_SIGNING: 'ready',
    },
  },
  {
    name: 'test Stripe key is launch blocking',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://noclickai-zeta.vercel.app/v1/connectors/google/callback',
      STRIPE_SECRET_KEY: 'sk_test_readiness_smoke',
      STRIPE_PRICE_ID: 'price_readiness_smoke',
      STRIPE_WEBHOOK_SECRET: 'whsec_readiness_smoke',
    },
    expected: {
      STRIPE_SECRET_KEY: 'missing',
      STRIPE_PRICE_ID: 'ready',
      STRIPE_WEBHOOK_SECRET: 'ready',
    },
  },
  {
    name: 'live Stripe key shape is ready',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://noclickai-zeta.vercel.app/v1/connectors/google/callback',
      STRIPE_SECRET_KEY: 'sk_live_readiness_smoke',
      STRIPE_PRICE_ID: 'price_readiness_smoke',
      STRIPE_WEBHOOK_SECRET: 'whsec_readiness_smoke',
    },
    expected: {
      STRIPE_SECRET_KEY: 'ready',
      STRIPE_PRICE_ID: 'ready',
      STRIPE_WEBHOOK_SECRET: 'ready',
    },
  },
  {
    name: 'Google redirect mismatch is launch blocking',
    env: {
      NOCLICK_SERVER_BASE_URL: 'https://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'https://wrong.example.test/v1/connectors/google/callback',
    },
    expected: {
      GOOGLE_REDIRECT_URI: 'missing',
    },
  },
  {
    name: 'Google redirect requires HTTPS',
    env: {
      NOCLICK_SERVER_BASE_URL: 'http://noclickai-zeta.vercel.app',
      GOOGLE_REDIRECT_URI: 'http://noclickai-zeta.vercel.app/v1/connectors/google/callback',
    },
    expected: {
      GOOGLE_REDIRECT_URI: 'missing',
    },
  },
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(output.join(''))
    try {
      const { response, body } = await fetchJson(baseUrl, '/health')
      if (response.ok && body.ok) return
    } catch {
      // Poll until the server starts or exits.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`server did not start: ${output.join('')}`)
}

async function runCase(testCase, index) {
  const port = Number(process.env.NOCLICK_READINESS_SMOKE_PORT || 60480) + index
  const baseUrl = `http://127.0.0.1:${port}`
  const dataDir = await mkdtemp(join(tmpdir(), `noclick-readiness-smoke-${index}-`))
  const output = []
  const env = {
    ...process.env,
    ...testCase.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NOCLICK_SYNC_DATA_DIR: dataDir,
    NOCLICK_SYNC_TOKEN: 'readiness-smoke-sync-token-that-is-not-for-production',
    NOCLICK_TOKEN_ENCRYPTION_KEY: 'readiness-smoke-token-encryption-key',
    NOCLICK_PUBLIC_APP_URL: PUBLIC_APP_URL,
    NOCLICK_ALLOWED_ORIGIN: PUBLIC_APP_URL,
    NOCLICK_ADMIN_EMAILS: 'readiness-smoke-admin@example.com',
    OPENAI_API_KEY: 'sk-readiness-smoke',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    DATABASE_URL: '',
    POSTGRES_URL: '',
    NOCLICK_REQUIRE_SUBSCRIPTION: 'false',
    NOCLICK_EXPOSE_ERROR_DETAILS: 'false',
  }

  const child = spawn(process.execPath, ['server/sync-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))

  try {
    await waitForServer(baseUrl, child, output)
    const email = `readiness-smoke-${index}-${Date.now()}@example.com`
    const register = await fetchJson(baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    assert(register.response.status === 201, `${testCase.name}: register returned HTTP ${register.response.status}`)
    assert(register.body.token, `${testCase.name}: register did not return a token`)

    const readiness = await fetchJson(baseUrl, '/v1/readiness', {
      headers: { Authorization: `Bearer ${register.body.token}` },
    })
    assert(readiness.response.ok, `${testCase.name}: readiness returned HTTP ${readiness.response.status}`)
    assert(readiness.body.ok, `${testCase.name}: readiness did not return ok=true`)

    for (const [id, expectedStatus] of Object.entries(testCase.expected)) {
      const item = readiness.body.items?.find((entry) => entry.id === id)
      assert(item, `${testCase.name}: /v1/readiness is missing ${id}`)
      assert(item.status === expectedStatus, `${testCase.name}: ${id} status is ${item.status}; expected ${expectedStatus}`)
      if (expectedStatus !== 'ready') {
        assert(item.launchBlocking === true, `${testCase.name}: ${id} should remain launchBlocking`)
      }
    }
  } finally {
    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await rm(dataDir, { recursive: true, force: true })
  }
}

for (let index = 0; index < cases.length; index += 1) {
  await runCase(cases[index], index)
}

console.log(`Readiness smoke passed: ${cases.length} case(s)`)
