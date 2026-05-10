import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.NOCLICK_SYNC_DATA_DIR || join(__dirname, 'data')
const DATA_FILE = join(DATA_DIR, 'workspaces.json')
const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '127.0.0.1'
const SYNC_TOKEN = process.env.NOCLICK_SYNC_TOKEN || 'dev-sync-token'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.NOCLICK_OPENAI_MODEL || 'gpt-5-nano'
const ALLOWED_ORIGIN = process.env.NOCLICK_ALLOWED_ORIGIN || '*'
const PUBLIC_APP_URL = process.env.NOCLICK_PUBLIC_APP_URL || `http://${HOST}:${PORT}`
const TLS_KEY_PATH = process.env.NOCLICK_TLS_KEY_PATH || ''
const TLS_CERT_PATH = process.env.NOCLICK_TLS_CERT_PATH || ''
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${PUBLIC_APP_URL}?billing=success`
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || `${PUBLIC_APP_URL}?billing=cancel`
const STRIPE_PORTAL_RETURN_URL = process.env.STRIPE_PORTAL_RETURN_URL || PUBLIC_APP_URL
const REQUIRE_SUBSCRIPTION = process.env.NOCLICK_REQUIRE_SUBSCRIPTION === 'true'
const MAX_BODY_BYTES = 1_000_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90
const SESSION_TTL_MS = Number(process.env.NOCLICK_SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300
const buckets = new Map()

function normalizeStore(store = {}) {
  return {
    workspaces: store.workspaces || {},
    users: store.users || {},
    sessions: store.sessions || {},
    billingEvents: store.billingEvents || {},
  }
}

async function readStore() {
  try {
    return normalizeStore(JSON.parse(await readFile(DATA_FILE, 'utf8')))
  } catch {
    return normalizeStore()
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`
  await writeFile(tempFile, JSON.stringify(normalizeStore(store), null, 2), 'utf8')
  await rename(tempFile, DATA_FILE)
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OpenAI-Key, X-Workspace-Id, Stripe-Signature',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

function getBearerToken(request) {
  const auth = String(request.headers.authorization || '')
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function isAdminAuthorized(request) {
  const token = getBearerToken(request)
  return Boolean(token && SYNC_TOKEN && safeEqual(token, SYNC_TOKEN))
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    subscriptionStatus: user.subscriptionStatus || 'free',
    billingPlan: user.billingPlan || 'free',
    createdAt: user.createdAt,
  }
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url')
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url')
  return { salt, hash }
}

function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false
  const hash = crypto.scryptSync(password, user.passwordSalt, 64).toString('base64url')
  return safeEqual(hash, user.passwordHash)
}

function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  store.sessions[hashSecret(token)] = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }
  return token
}

function getAuthenticatedUser(request, store) {
  const token = getBearerToken(request)
  if (!token) return null

  const tokenHash = hashSecret(token)
  const session = store.sessions[tokenHash]
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null

  const user = store.users[session.userId]
  if (!user) return null

  return { user, tokenHash }
}

function getApiAccess(request, store) {
  if (isAdminAuthorized(request)) return { type: 'admin' }
  const auth = getAuthenticatedUser(request, store)
  if (auth) return { type: 'user', user: auth.user, tokenHash: auth.tokenHash }
  return null
}

function hasPaidAccess(user) {
  return ['active', 'trialing'].includes(user?.subscriptionStatus)
}

async function readRawBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request_body_too_large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readBody(request) {
  const raw = await readRawBody(request)
  if (!raw.length) return {}

  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    const error = new Error('invalid_json')
    error.statusCode = 400
    throw error
  }
}

function getWorkspaceId(request, url, access) {
  return request.headers['x-workspace-id'] || url.searchParams.get('workspaceId') || access?.user?.id || ''
}

function checkRateLimit(request) {
  const key = request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const bucket = buckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }

  if (bucket.resetAt < now) {
    bucket.count = 0
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS
  }

  bucket.count += 1
  buckets.set(key, bucket)
  return bucket.count <= RATE_LIMIT_MAX
}

function findUserByEmail(store, email) {
  return Object.values(store.users).find((user) => user.email === email)
}

function findUserByStripeReference(store, reference) {
  if (!reference) return null
  return Object.values(store.users).find(
    (user) => user.id === reference || user.stripeCustomerId === reference || user.stripeSubscriptionId === reference,
  )
}

async function handleAuth(request, response, url) {
  const store = await readStore()

  if (url.pathname === '/v1/auth/register' && request.method === 'POST') {
    const body = await readBody(request)
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')
    const name = String(body.name || email.split('@')[0] || 'NoClick User').trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(response, 400, { error: 'invalid_email' })
      return
    }
    if (password.length < 8) {
      sendJson(response, 400, { error: 'password_too_short' })
      return
    }
    if (findUserByEmail(store, email)) {
      sendJson(response, 409, { error: 'email_already_registered' })
      return
    }

    const passwordHash = createPasswordHash(password)
    const user = {
      id: `usr_${crypto.randomBytes(12).toString('hex')}`,
      email,
      name,
      passwordHash: passwordHash.hash,
      passwordSalt: passwordHash.salt,
      subscriptionStatus: 'free',
      billingPlan: 'free',
      createdAt: new Date().toISOString(),
    }

    store.users[user.id] = user
    const token = createSession(store, user.id)
    await writeStore(store)
    sendJson(response, 201, { ok: true, token, user: publicUser(user) })
    return
  }

  if (url.pathname === '/v1/auth/login' && request.method === 'POST') {
    const body = await readBody(request)
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')
    const user = findUserByEmail(store, email)

    if (!user || !verifyPassword(password, user)) {
      sendJson(response, 401, { error: 'invalid_credentials' })
      return
    }

    user.lastLoginAt = new Date().toISOString()
    const token = createSession(store, user.id)
    await writeStore(store)
    sendJson(response, 200, { ok: true, token, user: publicUser(user) })
    return
  }

  if (url.pathname === '/v1/auth/logout' && request.method === 'POST') {
    const auth = getAuthenticatedUser(request, store)
    if (auth) {
      delete store.sessions[auth.tokenHash]
      await writeStore(store)
    }
    sendJson(response, 200, { ok: true })
    return
  }

  if (url.pathname === '/v1/auth/me' && request.method === 'GET') {
    const auth = getAuthenticatedUser(request, store)
    if (!auth) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }
    sendJson(response, 200, { ok: true, user: publicUser(auth.user) })
    return
  }

  sendJson(response, 405, { error: 'method_not_allowed' })
}

function stripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID)
}

async function stripeFormRequest(path, params) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value))
  }

  const stripeResponse = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const responseBody = await stripeResponse.json().catch(() => ({}))
  if (!stripeResponse.ok) {
    const error = new Error(responseBody.error?.message || stripeResponse.statusText)
    error.statusCode = stripeResponse.status
    throw error
  }
  return responseBody
}

async function handleBilling(request, response, url) {
  const store = await readStore()
  const auth = getAuthenticatedUser(request, store)
  if (!auth) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }

  if (url.pathname === '/v1/billing/status' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      user: publicUser(auth.user),
      stripeConfigured: stripeConfigured(),
      checkoutReady: stripeConfigured(),
      portalReady: Boolean(STRIPE_SECRET_KEY && auth.user.stripeCustomerId),
    })
    return
  }

  if (url.pathname === '/v1/billing/checkout' && request.method === 'POST') {
    if (!stripeConfigured()) {
      sendJson(response, 400, { error: 'stripe_not_configured' })
      return
    }

    const session = await stripeFormRequest('/v1/checkout/sessions', {
      mode: 'subscription',
      client_reference_id: auth.user.id,
      customer: auth.user.stripeCustomerId,
      customer_email: auth.user.stripeCustomerId ? undefined : auth.user.email,
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': 1,
      success_url: STRIPE_SUCCESS_URL,
      cancel_url: STRIPE_CANCEL_URL,
      'metadata[userId]': auth.user.id,
      'subscription_data[metadata][userId]': auth.user.id,
    })

    sendJson(response, 200, { ok: true, url: session.url, id: session.id })
    return
  }

  if (url.pathname === '/v1/billing/portal' && request.method === 'POST') {
    if (!STRIPE_SECRET_KEY) {
      sendJson(response, 400, { error: 'stripe_not_configured' })
      return
    }
    if (!auth.user.stripeCustomerId) {
      sendJson(response, 400, { error: 'stripe_customer_missing' })
      return
    }

    const session = await stripeFormRequest('/v1/billing_portal/sessions', {
      customer: auth.user.stripeCustomerId,
      return_url: STRIPE_PORTAL_RETURN_URL,
    })

    sendJson(response, 200, { ok: true, url: session.url })
    return
  }

  sendJson(response, 405, { error: 'method_not_allowed' })
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET || !signatureHeader) return false

  const parts = String(signatureHeader)
    .split(',')
    .map((part) => part.split('='))
    .reduce(
      (result, [key, value]) => {
        if (key === 't') result.timestamp = value
        if (key === 'v1') result.signatures.push(value)
        return result
      },
      { timestamp: '', signatures: [] },
    )

  if (!parts.timestamp || !parts.signatures.length) return false
  const timestamp = Number(parts.timestamp)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) return false

  const signedPayload = `${parts.timestamp}.${rawBody.toString('utf8')}`
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex')
  return parts.signatures.some((signature) => safeEqual(signature, expected))
}

function applyStripeEvent(store, event) {
  if (event.id && store.billingEvents[event.id]) return { duplicate: true }

  const object = event.data?.object || {}
  const userReference = object.client_reference_id || object.metadata?.userId || object.customer || object.subscription || object.id
  const user = findUserByStripeReference(store, userReference)

  if (user && event.type === 'checkout.session.completed') {
    user.stripeCustomerId = object.customer || user.stripeCustomerId
    user.stripeSubscriptionId = object.subscription || user.stripeSubscriptionId
    user.subscriptionStatus = object.payment_status === 'paid' || object.status === 'complete' ? 'active' : 'checkout_complete'
    user.billingPlan = 'pro'
    user.billingUpdatedAt = new Date().toISOString()
  }

  if (user && event.type === 'customer.subscription.updated') {
    user.stripeSubscriptionId = object.id || user.stripeSubscriptionId
    user.stripeCustomerId = object.customer || user.stripeCustomerId
    user.subscriptionStatus = object.status || user.subscriptionStatus
    user.billingPlan = object.status === 'active' || object.status === 'trialing' ? 'pro' : user.billingPlan
    user.billingUpdatedAt = new Date().toISOString()
  }

  if (user && event.type === 'customer.subscription.deleted') {
    user.stripeSubscriptionId = object.id || user.stripeSubscriptionId
    user.subscriptionStatus = 'canceled'
    user.billingPlan = 'free'
    user.billingUpdatedAt = new Date().toISOString()
  }

  if (user && event.type === 'invoice.payment_succeeded') {
    user.stripeCustomerId = object.customer || user.stripeCustomerId
    user.stripeSubscriptionId = object.subscription || user.stripeSubscriptionId
    user.subscriptionStatus = 'active'
    user.billingPlan = 'pro'
    user.billingUpdatedAt = new Date().toISOString()
  }

  if (user && event.type === 'invoice.payment_failed') {
    user.stripeCustomerId = object.customer || user.stripeCustomerId
    user.stripeSubscriptionId = object.subscription || user.stripeSubscriptionId
    user.subscriptionStatus = 'past_due'
    user.billingUpdatedAt = new Date().toISOString()
  }

  if (event.id) {
    store.billingEvents[event.id] = {
      type: event.type,
      processedAt: new Date().toISOString(),
      userId: user?.id || null,
    }
  }

  return { duplicate: false, userId: user?.id || null }
}

async function handleStripeWebhook(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' })
    return
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    sendJson(response, 400, { error: 'stripe_webhook_secret_required' })
    return
  }

  const rawBody = await readRawBody(request)
  if (!verifyStripeSignature(rawBody, request.headers['stripe-signature'])) {
    sendJson(response, 400, { error: 'invalid_stripe_signature' })
    return
  }

  const event = JSON.parse(rawBody.toString('utf8'))
  const store = await readStore()
  const result = applyStripeEvent(store, event)
  await writeStore(store)
  sendJson(response, 200, { ok: true, received: true, ...result })
}

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'category', 'dueLabel', 'clickSavings', 'timeSavings', 'apps', 'steps', 'summary'],
  properties: {
    title: { type: 'string' },
    category: { type: 'string' },
    dueLabel: { type: 'string' },
    clickSavings: { type: 'number' },
    timeSavings: { type: 'number' },
    apps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'app', 'detail', 'preview', 'risk'],
        properties: {
          title: { type: 'string' },
          app: { type: 'string' },
          detail: { type: 'string' },
          preview: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high', 'blocked'] },
        },
      },
    },
  },
}

function extractOutputText(responseBody) {
  if (typeof responseBody.output_text === 'string') return responseBody.output_text

  const output = Array.isArray(responseBody.output) ? responseBody.output : []
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text || '')
    .filter(Boolean)
    .join('\n')
}

async function createAiPlan(request) {
  const body = await readBody(request)
  const openAiKey = String(request.headers['x-openai-key'] || OPENAI_API_KEY).trim()
  const prompt = String(body.prompt || '').trim()
  const localeNow = String(body.localeNow || new Date().toISOString())

  if (!openAiKey) return { status: 400, body: { error: 'openai_key_required' } }
  if (!prompt) return { status: 400, body: { error: 'prompt_required' } }

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model || OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content:
            'You create Korean task automation plans for NoClick AI. Return only structured data. Never include payment, transfer, account deletion, or mass personal data submission as executable steps; mark them blocked.',
        },
        {
          role: 'user',
          content: `현재 시각: ${localeNow}\n사용자 목적: ${prompt}\n앱 후보: Google Calendar, Gmail, Notion, Google Drive, Slack, Discord, Browser Agent\n각 단계는 위험도와 승인 필요성을 반영해야 합니다.`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'noclick_plan',
          strict: true,
          schema: planSchema,
        },
      },
    }),
  })

  const responseBody = await openAiResponse.json().catch(() => ({}))
  if (!openAiResponse.ok) {
    return {
      status: openAiResponse.status,
      body: {
        error: 'openai_request_failed',
        detail: responseBody.error?.message || openAiResponse.statusText,
      },
    }
  }

  const text = extractOutputText(responseBody)
  return {
    status: 200,
    body: {
      ok: true,
      plan: JSON.parse(text),
      model: body.model || OPENAI_MODEL,
    },
  }
}

async function handleRequest(request, response) {
  const protocol = TLS_KEY_PATH && TLS_CERT_PATH ? 'https' : 'http'
  const url = new URL(request.url || '/', `${protocol}://${request.headers.host || `${HOST}:${PORT}`}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'noclick-sync',
      aiPlanner: true,
      auth: true,
      billing: true,
      model: OPENAI_MODEL,
      protocol,
      serverKeyConfigured: Boolean(OPENAI_API_KEY),
      stripeConfigured: stripeConfigured(),
      stripeWebhookConfigured: Boolean(STRIPE_WEBHOOK_SECRET),
      requireSubscription: REQUIRE_SUBSCRIPTION,
      storage: DATA_FILE,
      time: new Date().toISOString(),
    })
    return
  }

  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: 'rate_limited' })
    return
  }

  try {
    if (url.pathname === '/v1/billing/webhook') {
      await handleStripeWebhook(request, response)
      return
    }

    if (url.pathname.startsWith('/v1/auth/')) {
      await handleAuth(request, response, url)
      return
    }

    if (url.pathname.startsWith('/v1/billing/')) {
      await handleBilling(request, response, url)
      return
    }

    if (url.pathname !== '/v1/state' && url.pathname !== '/v1/plan') {
      sendJson(response, 404, { error: 'not_found' })
      return
    }

    const store = await readStore()
    const access = getApiAccess(request, store)
    if (!access) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }
    if (REQUIRE_SUBSCRIPTION && access.type === 'user' && !hasPaidAccess(access.user)) {
      sendJson(response, 402, { error: 'subscription_required' })
      return
    }

    const workspaceId = String(getWorkspaceId(request, url, access)).trim()
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspace_required' })
      return
    }

    if (url.pathname === '/v1/plan') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      const result = await createAiPlan(request)
      sendJson(response, result.status, result.body)
      return
    }

    if (request.method === 'GET') {
      const snapshot = store.workspaces[workspaceId]
      if (!snapshot) {
        sendJson(response, 404, { error: 'empty_workspace' })
        return
      }
      sendJson(response, 200, snapshot)
      return
    }

    if (request.method === 'PUT') {
      const snapshot = await readBody(request)
      store.workspaces[workspaceId] = {
        ...snapshot,
        serverSavedAt: new Date().toISOString(),
      }
      await writeStore(store)
      sendJson(response, 200, { ok: true, workspaceId, savedAt: store.workspaces[workspaceId].serverSavedAt })
      return
    }

    sendJson(response, 405, { error: 'method_not_allowed' })
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: 'server_error',
      detail: error instanceof Error ? error.message : 'unknown',
    })
  }
}

if (Boolean(TLS_KEY_PATH) !== Boolean(TLS_CERT_PATH)) {
  throw new Error('NOCLICK_TLS_KEY_PATH and NOCLICK_TLS_CERT_PATH must be set together.')
}

const protocol = TLS_KEY_PATH && TLS_CERT_PATH ? 'https' : 'http'
const server =
  protocol === 'https'
    ? createHttpsServer(
        {
          key: readFileSync(TLS_KEY_PATH),
          cert: readFileSync(TLS_CERT_PATH),
        },
        handleRequest,
      )
    : createHttpServer(handleRequest)

server.listen(PORT, HOST, () => {
  console.log(`NoClick Sync server listening on ${protocol}://${HOST}:${PORT}`)
  if (SYNC_TOKEN === 'dev-sync-token') {
    console.log('Set NOCLICK_SYNC_TOKEN in production. Current token is for local development only.')
  }
  if (!stripeConfigured()) {
    console.log('Stripe checkout is disabled until STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set.')
  }
})
