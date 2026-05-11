import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.NOCLICK_SYNC_DATA_DIR || (process.env.VERCEL ? join(tmpdir(), 'noclick-data') : join(__dirname, 'data'))
const DATA_FILE = join(DATA_DIR, 'workspaces.json')
const WEB_DIR = process.env.NOCLICK_WEB_DIR || join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '127.0.0.1'
const SYNC_TOKEN = process.env.NOCLICK_SYNC_TOKEN || 'dev-sync-token'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.NOCLICK_OPENAI_MODEL || 'gpt-5-nano'
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''
const ALLOWED_ORIGIN = process.env.NOCLICK_ALLOWED_ORIGIN || '*'
const PUBLIC_APP_URL = process.env.NOCLICK_PUBLIC_APP_URL || `http://${HOST}:${PORT}`
const SERVER_BASE_URL = process.env.NOCLICK_SERVER_BASE_URL || `http://${HOST}:${PORT}`
const TLS_KEY_PATH = process.env.NOCLICK_TLS_KEY_PATH || ''
const TLS_CERT_PATH = process.env.NOCLICK_TLS_CERT_PATH || ''
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${PUBLIC_APP_URL}?billing=success`
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || `${PUBLIC_APP_URL}?billing=cancel`
const STRIPE_PORTAL_RETURN_URL = process.env.STRIPE_PORTAL_RETURN_URL || PUBLIC_APP_URL
const REQUIRE_SUBSCRIPTION = process.env.NOCLICK_REQUIRE_SUBSCRIPTION === 'true'
const TOKEN_ENCRYPTION_KEY = process.env.NOCLICK_TOKEN_ENCRYPTION_KEY || SYNC_TOKEN
const ENABLE_GMAIL_DRAFTS = process.env.NOCLICK_ENABLE_GMAIL_DRAFTS === 'true'
const ADMIN_EMAILS = new Set(
  String(process.env.NOCLICK_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
)
const MAX_BODY_BYTES = 1_000_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90
const SESSION_TTL_MS = Number(process.env.NOCLICK_SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300
const OPENAI_REQUEST_TIMEOUT_MS = Number(process.env.NOCLICK_OPENAI_TIMEOUT_MS || 25_000)
const STORE_ID = 'default'
const STORE_TABLE = 'noclick_store'
const STORAGE_TARGET = DATABASE_URL ? `postgres:${STORE_TABLE}/${STORE_ID}` : DATA_FILE
const GMAIL_ACTIONS = ENABLE_GMAIL_DRAFTS
  ? ['gmail.prepare_message', 'gmail.create_draft', 'gmail.send_message']
  : ['gmail.prepare_message', 'gmail.send_message']
const TELEGRAM_ACTIONS = ['telegram.prepare_message', 'telegram.send_message']
const RELEASE_TAG = process.env.NOCLICK_RELEASE_TAG || 'v0.1.0-internal.1'
const RELEASE_BASE_URL = `https://github.com/yangyu0330/NoClickAI/releases/download/${RELEASE_TAG}`
const RELEASE_PAGE_URL = `https://github.com/yangyu0330/NoClickAI/releases/tag/${RELEASE_TAG}`
const RELEASE_ASSETS = [
  {
    id: 'android-apk',
    label: 'Android APK',
    fileName: `NoClickAI-Android-${RELEASE_TAG}.apk`,
  },
  {
    id: 'android-aab',
    label: 'Android AAB',
    fileName: `NoClickAI-Android-${RELEASE_TAG}.aab`,
  },
  {
    id: 'windows-installer',
    label: 'Windows installer',
    fileName: `NoClickAI-Windows-Setup-${RELEASE_TAG}.exe`,
  },
  {
    id: 'sha256sums',
    label: 'Release checksums',
    fileName: 'SHA256SUMS.txt',
  },
]
const buckets = new Map()
let postgresClient = null
let postgresStoreReady = false
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

const CONNECTOR_DEFINITIONS = [
  {
    id: 'google-calendar',
    tokenProvider: 'google',
    name: 'Google Calendar',
    type: 'oauth',
    actions: ['calendar.create_event'],
    configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  },
  {
    id: 'gmail',
    tokenProvider: 'google',
    name: 'Gmail',
    type: 'oauth',
    actions: GMAIL_ACTIONS,
    configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  },
  {
    id: 'notion',
    tokenProvider: 'notion',
    name: 'Notion',
    type: 'oauth',
    actions: ['notion.create_page'],
    configured: () => Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
  },
  {
    id: 'slack',
    tokenProvider: 'slack',
    name: 'Slack',
    type: 'oauth',
    actions: ['slack.post_message'],
    configured: () => Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
  },
  {
    id: 'telegram',
    tokenProvider: 'telegram',
    name: 'Telegram',
    type: 'bot_or_share',
    actions: TELEGRAM_ACTIONS,
    configured: () => true,
  },
  {
    id: 'kakao',
    tokenProvider: 'kakao',
    name: 'KakaoTalk',
    type: 'share',
    actions: ['kakao.share_text'],
    configured: () => true,
  },
]

const PROVIDER_ALIASES = {
  google: 'google',
  'google-calendar': 'google',
  gmail: 'google',
  notion: 'notion',
  slack: 'slack',
  kakao: 'kakao',
}

const OAUTH_PROVIDERS = {
  google: {
    name: 'Google',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${SERVER_BASE_URL}/v1/connectors/google/callback`,
    scopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.send',
      ...(ENABLE_GMAIL_DRAFTS ? ['https://www.googleapis.com/auth/gmail.compose'] : []),
    ],
  },
  notion: {
    name: 'Notion',
    clientId: process.env.NOTION_CLIENT_ID || '',
    clientSecret: process.env.NOTION_CLIENT_SECRET || '',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    redirectUri: process.env.NOTION_REDIRECT_URI || `${SERVER_BASE_URL}/v1/connectors/notion/callback`,
    scopes: [],
  },
  slack: {
    name: 'Slack',
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    redirectUri: process.env.SLACK_REDIRECT_URI || `${SERVER_BASE_URL}/v1/connectors/slack/callback`,
    scopes: ['chat:write', 'channels:read', 'groups:read'],
  },
  kakao: {
    name: 'Kakao',
    clientId: process.env.KAKAO_CLIENT_ID || '',
    clientSecret: process.env.KAKAO_CLIENT_SECRET || '',
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    redirectUri: process.env.KAKAO_REDIRECT_URI || `${SERVER_BASE_URL}/v1/connectors/kakao/callback`,
    scopes: ['talk_message'],
  },
}

const ALLOWED_ACTIONS = {
  'google-calendar': ['calendar.create_event'],
  gmail: GMAIL_ACTIONS,
  notion: ['notion.create_page'],
  slack: ['slack.post_message'],
  telegram: ['telegram.send_message'],
  kakao: ['kakao.share_text'],
}

function normalizeStore(store = {}) {
  return {
    workspaces: store.workspaces || {},
    users: store.users || {},
    sessions: store.sessions || {},
    billingEvents: store.billingEvents || {},
    connections: store.connections || {},
    runs: store.runs || {},
    auditLogs: store.auditLogs || {},
    oauthStates: store.oauthStates || {},
  }
}

function getPostgresClient() {
  if (!DATABASE_URL) return null
  postgresClient ||= neon(DATABASE_URL)
  return postgresClient
}

async function ensurePostgresStore() {
  if (postgresStoreReady) return
  const sql = getPostgresClient()
  if (!sql) return

  await sql`
    CREATE TABLE IF NOT EXISTS noclick_store (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
  postgresStoreReady = true
}

async function readPostgresStore() {
  await ensurePostgresStore()
  const sql = getPostgresClient()
  const rows = await sql`SELECT data FROM noclick_store WHERE id = ${STORE_ID} LIMIT 1`
  return normalizeStore(rows[0]?.data || {})
}

async function writePostgresStore(store) {
  await ensurePostgresStore()
  const sql = getPostgresClient()
  const normalized = normalizeStore(store)
  await sql`
    INSERT INTO noclick_store (id, data, updated_at)
    VALUES (${STORE_ID}, ${JSON.stringify(normalized)}::jsonb, now())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `
}

async function readStore() {
  if (DATABASE_URL) return readPostgresStore()

  try {
    return normalizeStore(JSON.parse(await readFile(DATA_FILE, 'utf8')))
  } catch {
    return normalizeStore()
  }
}

async function writeStore(store) {
  if (DATABASE_URL) {
    await writePostgresStore(store)
    return
  }

  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`
  await writeFile(tempFile, JSON.stringify(normalizeStore(store), null, 2), 'utf8')
  await rename(tempFile, DATA_FILE)
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OpenAI-Key, X-Workspace-Id, Stripe-Signature',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

async function sendStatic(response, url) {
  const pathname = decodeURIComponent(url.pathname)
  const safePath = pathname === '/' ? '/index.html' : pathname
  const target = join(WEB_DIR, safePath.replace(/^\/+/, ''))
  const root = join(WEB_DIR)

  if (!target.startsWith(root)) {
    sendJson(response, 403, { error: 'forbidden' })
    return
  }

  try {
    const info = await stat(target)
    if (!info.isFile()) throw new Error('not_file')
    const ext = target.slice(target.lastIndexOf('.'))
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    response.end(await readFile(target))
  } catch {
    try {
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      response.end(await readFile(join(WEB_DIR, 'index.html')))
    } catch {
      sendJson(response, 404, { error: 'not_found' })
    }
  }
}

function redirect(response, location) {
  response.writeHead(302, {
    ...SECURITY_HEADERS,
    Location: location,
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  })
  response.end()
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

function tokenCipherKey() {
  return crypto.createHash('sha256').update(TOKEN_ENCRYPTION_KEY || 'noclick-dev-key').digest()
}

function protectToken(value) {
  if (!value) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenCipherKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

function revealToken(value) {
  if (!value || !String(value).startsWith('v1.')) return value || ''
  const [, iv, tag, encrypted] = String(value).split('.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenCipherKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email))
}

function isAdminUser(user) {
  return Boolean(user && (user.admin === true || user.role === 'admin' || isAdminEmail(user.email)))
}

function applyAdminEntitlements(user) {
  if (!isAdminUser(user)) return user

  user.admin = true
  user.role = 'admin'
  user.subscriptionStatus = 'active'
  user.billingPlan = 'admin'
  user.adminGrantedAt ||= new Date().toISOString()
  return user
}

function publicUser(user) {
  const isAdmin = isAdminUser(user)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: isAdmin ? 'admin' : user.role || 'user',
    isAdmin,
    subscriptionStatus: isAdmin ? 'active' : user.subscriptionStatus || 'free',
    billingPlan: isAdmin ? 'admin' : user.billingPlan || 'free',
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
  applyAdminEntitlements(user)

  return { user, tokenHash }
}

function getApiAccess(request, store) {
  if (isAdminAuthorized(request)) return { type: 'admin' }
  const auth = getAuthenticatedUser(request, store)
  if (auth) return { type: 'user', user: auth.user, tokenHash: auth.tokenHash }
  return null
}

function requireUserAccess(request, store) {
  const auth = getAuthenticatedUser(request, store)
  if (!auth) return null
  if (REQUIRE_SUBSCRIPTION && !hasPaidAccess(auth.user)) return { paymentRequired: true, user: auth.user }
  return auth
}

function hasPaidAccess(user) {
  return isAdminUser(user) || ['active', 'trialing'].includes(user?.subscriptionStatus)
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

function deleteUserData(store, userId) {
  const deleted = {
    user: Boolean(store.users[userId]),
    sessions: 0,
    connections: store.connections[userId] ? 1 : 0,
    runs: 0,
    auditLogs: 0,
    oauthStates: 0,
    workspaces: store.workspaces[userId] ? 1 : 0,
    billingEvents: 0,
  }

  delete store.users[userId]
  delete store.connections[userId]
  delete store.workspaces[userId]

  for (const [sessionHash, session] of Object.entries(store.sessions || {})) {
    if (session.userId === userId) {
      delete store.sessions[sessionHash]
      deleted.sessions += 1
    }
  }

  for (const [runId, run] of Object.entries(store.runs || {})) {
    if (run.userId === userId) {
      delete store.runs[runId]
      deleted.runs += 1
    }
  }

  for (const [logId, log] of Object.entries(store.auditLogs || {})) {
    if (log.userId === userId) {
      delete store.auditLogs[logId]
      deleted.auditLogs += 1
    }
  }

  for (const [stateHash, state] of Object.entries(store.oauthStates || {})) {
    if (state.userId === userId) {
      delete store.oauthStates[stateHash]
      deleted.oauthStates += 1
    }
  }

  for (const [eventId, event] of Object.entries(store.billingEvents || {})) {
    if (event.userId === userId) {
      delete store.billingEvents[eventId]
      deleted.billingEvents += 1
    }
  }

  return deleted
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
    applyAdminEntitlements(user)

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
    applyAdminEntitlements(user)
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

  if (url.pathname === '/v1/auth/delete-account' && request.method === 'POST') {
    const auth = getAuthenticatedUser(request, store)
    if (!auth) {
      sendJson(response, 401, { error: 'unauthorized' })
      return
    }

    const body = await readBody(request)
    const confirmEmail = normalizeEmail(body.confirmEmail)
    if (confirmEmail !== auth.user.email) {
      sendJson(response, 400, { error: 'email_confirmation_required' })
      return
    }

    const deleted = deleteUserData(store, auth.user.id)
    await writeStore(store)
    sendJson(response, 200, { ok: true, deleted })
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
    const admin = isAdminUser(auth.user)
    sendJson(response, 200, {
      ok: true,
      user: publicUser(auth.user),
      stripeConfigured: stripeConfigured(),
      checkoutReady: !admin && stripeConfigured(),
      portalReady: !admin && Boolean(STRIPE_SECRET_KEY && auth.user.stripeCustomerId),
    })
    return
  }

  if (url.pathname === '/v1/billing/checkout' && request.method === 'POST') {
    if (isAdminUser(auth.user)) {
      sendJson(response, 200, { ok: true, admin: true, url: PUBLIC_APP_URL })
      return
    }
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
    if (isAdminUser(auth.user)) {
      sendJson(response, 400, { error: 'admin_billing_not_required' })
      return
    }
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

function connectionBucket(store, userId) {
  if (!store.connections[userId]) store.connections[userId] = {}
  return store.connections[userId]
}

function getRawConnection(store, userId, tokenProvider) {
  return store.connections[userId]?.[tokenProvider] || null
}

function getConnection(store, userId, tokenProvider) {
  const connection = getRawConnection(store, userId, tokenProvider)
  if (!connection) return null
  return {
    ...connection,
    accessToken: revealToken(connection.accessToken),
    refreshToken: revealToken(connection.refreshToken),
  }
}

function saveConnection(store, userId, tokenProvider, payload) {
  connectionBucket(store, userId)[tokenProvider] = {
    provider: tokenProvider,
    accessToken: protectToken(payload.accessToken),
    refreshToken: payload.refreshToken ? protectToken(payload.refreshToken) : getRawConnection(store, userId, tokenProvider)?.refreshToken || '',
    expiresAt: payload.expiresAt || null,
    scopes: payload.scopes || [],
    metadata: payload.metadata || {},
    connectedAt: new Date().toISOString(),
  }
}

function connectorStatuses(store, userId) {
  return CONNECTOR_DEFINITIONS.map((definition) => {
    const providerKey = oauthProviderFromConnector(definition.id)
    const oauthProvider = OAUTH_PROVIDERS[providerKey]
    const missingConfig =
      definition.type === 'bot' || definition.type === 'bot_or_share' || definition.type === 'share'
        ? []
        : [
            oauthProvider?.clientId ? '' : `${providerKey.toUpperCase()}_CLIENT_ID`,
            oauthProvider?.clientSecret ? '' : `${providerKey.toUpperCase()}_CLIENT_SECRET`,
          ].filter(Boolean)
    const connected =
      definition.id === 'telegram'
        ? Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_DEFAULT_CHAT_ID)
        : Boolean(getRawConnection(store, userId, definition.tokenProvider))
    return {
      id: definition.id,
      name: definition.name,
      provider: providerKey,
      type: definition.type,
      actions: definition.actions,
      configured: definition.configured(),
      connected,
      needsOAuth: definition.type === 'oauth' || (definition.type === 'oauth_or_share' && definition.configured()),
      redirectUri: oauthProvider?.redirectUri || '',
      scopes: oauthProvider?.scopes || [],
      missingConfig,
    }
  })
}

function readinessItem(id, category, label, status, detail = '', action = '') {
  return { id, category, label, status, detail, action }
}

function envPresent(name) {
  return Boolean(String(process.env[name] || '').trim())
}

function envConfiguredItem(name, category, label, detail = '') {
  return readinessItem(
    name,
    category,
    label,
    envPresent(name) ? 'ready' : 'missing',
    envPresent(name) ? detail || 'Configured.' : `${name} is missing.`,
    envPresent(name) ? '' : `Set ${name} in Vercel Production environment variables and redeploy.`,
  )
}

function releaseAssetUrl(asset) {
  return `${RELEASE_BASE_URL}/${asset.fileName}`
}

async function checkHttpUrl(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6_000)
  try {
    const result = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    return { ok: result.ok, status: result.status }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkHttpText(url, requiredText = []) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6_000)
  try {
    const result = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })
    const text = await result.text()
    const missingText = requiredText.filter((item) => !text.includes(item))
    return {
      ok: result.ok && missingText.length === 0,
      status: result.status,
      missingText,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'request_failed',
      missingText: requiredText,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function publicReviewReadinessItems() {
  const pages = [
    {
      id: 'PRIVACY_POLICY_URL',
      label: 'Privacy policy URL',
      url: `${PUBLIC_APP_URL}/privacy`,
      requiredText: ['Privacy Policy', 'Google User Data', 'Limited Use', '/data-deletion'],
    },
    {
      id: 'TERMS_URL',
      label: 'Terms of service URL',
      url: `${PUBLIC_APP_URL}/terms`,
      requiredText: ['Terms of Service', 'High-Risk Actions'],
    },
    {
      id: 'DATA_DELETION_URL',
      label: 'Data deletion URL',
      url: `${PUBLIC_APP_URL}/data-deletion`,
      requiredText: ['Data Deletion', 'Delete Your Account', 'Disconnect Google'],
    },
  ]

  const checks = await Promise.all(
    pages.map((page) =>
      checkHttpText(page.url, page.requiredText).then((check) => ({
        ...page,
        ...check,
      })),
    ),
  )

  return checks.map((check) =>
    readinessItem(
      check.id,
      'legal',
      check.label,
      check.ok ? 'ready' : 'warning',
      check.ok
        ? `${check.url} is reachable and contains required review text.`
        : `${check.url} is missing required review text${check.missingText?.length ? `: ${check.missingText.join(', ')}` : ''}.`,
      check.ok ? '' : 'Update the public review page and redeploy.',
    ),
  )
}

async function releaseReadinessItems() {
  const checks = await Promise.all([
    checkHttpUrl(`${PUBLIC_APP_URL}/downloads`).then((check) => ({
      id: 'DOWNLOADS_URL',
      category: 'apps',
      label: 'Downloads page',
      url: `${PUBLIC_APP_URL}/downloads`,
      ...check,
    })),
    checkHttpUrl(RELEASE_PAGE_URL).then((check) => ({
      id: 'GITHUB_RELEASE',
      category: 'apps',
      label: 'GitHub release',
      url: RELEASE_PAGE_URL,
      ...check,
    })),
    ...RELEASE_ASSETS.map((asset) =>
      checkHttpUrl(releaseAssetUrl(asset)).then((check) => ({
        id: `release:${asset.id}`,
        category: 'apps',
        label: asset.label,
        url: releaseAssetUrl(asset),
        ...check,
      })),
    ),
  ])

  return checks.map((check) =>
    readinessItem(
      check.id,
      check.category,
      check.label,
      check.ok ? 'ready' : 'warning',
      check.ok ? `${check.url} is reachable.` : `${check.url} did not return a successful response${check.status ? ` (HTTP ${check.status})` : ''}.`,
      check.ok ? '' : 'Re-publish the release artifact or update NOCLICK_RELEASE_TAG.',
    ),
  )
}

function connectorReadinessItems(store, userId) {
  return connectorStatuses(store, userId).flatMap((connector) => {
    if (connector.type === 'share') {
      return [
        readinessItem(
          `${connector.id}:configured`,
          'connectors',
          `${connector.name} share fallback`,
          'ready',
          `${connector.name} uses browser and Android share fallback, so server credentials are not required for prepared share text.`,
          '',
        ),
      ]
    }

    if (connector.type === 'bot_or_share') {
      const botReady = envPresent('TELEGRAM_BOT_TOKEN') && envPresent('TELEGRAM_DEFAULT_CHAT_ID')
      return [
        readinessItem(
          `${connector.id}:configured`,
          'connectors',
          `${connector.name} share fallback`,
          'ready',
          `${connector.name} can prepare share text for browser and Android sharing without server credentials.`,
          '',
        ),
        readinessItem(
          `${connector.id}:bot`,
          'connectors',
          `${connector.name} bot delivery`,
          botReady ? 'ready' : 'warning',
          botReady ? 'Telegram Bot API delivery is configured.' : 'Telegram Bot API delivery is not configured; share fallback remains available.',
          botReady ? '' : 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_DEFAULT_CHAT_ID only when direct bot delivery is required.',
        ),
      ]
    }

    const items = [
      readinessItem(
        `${connector.id}:configured`,
        'connectors',
        `${connector.name} configuration`,
        connector.configured ? 'ready' : 'missing',
        connector.configured
          ? `${connector.name} server configuration is present.`
          : connector.missingConfig?.length
            ? `Missing ${connector.missingConfig.join(', ')}.`
            : `${connector.name} server configuration is missing.`,
        connector.configured ? '' : 'Add the missing provider credentials and redeploy.',
      ),
    ]

    if (connector.needsOAuth && connector.configured) {
      items.push(
        readinessItem(
          `${connector.id}:connected`,
          'connectors',
          `${connector.name} user connection`,
          connector.connected ? 'ready' : 'warning',
          connector.connected ? `${connector.name} is connected for this user.` : `${connector.name} OAuth is not connected for this user.`,
          connector.connected ? '' : `Open the app and connect ${connector.name}.`,
        ),
      )
    }

    return items
  })
}

async function productionReadinessReport(store, userId) {
  const items = [
    envConfiguredItem('OPENAI_API_KEY', 'core', 'OpenAI API key'),
    envConfiguredItem('DATABASE_URL', 'core', 'Postgres database'),
    envConfiguredItem('NOCLICK_ADMIN_EMAILS', 'core', 'Admin email allowlist'),
    readinessItem(
      'NOCLICK_SYNC_TOKEN',
      'core',
      'Server sync token',
      SYNC_TOKEN && SYNC_TOKEN !== 'dev-sync-token' ? 'ready' : 'missing',
      SYNC_TOKEN && SYNC_TOKEN !== 'dev-sync-token' ? 'Production sync token is configured.' : 'NOCLICK_SYNC_TOKEN is missing or still using dev-sync-token.',
      SYNC_TOKEN && SYNC_TOKEN !== 'dev-sync-token' ? '' : 'Set NOCLICK_SYNC_TOKEN to a long random value.',
    ),
    readinessItem(
      'NOCLICK_ALLOWED_ORIGIN',
      'core',
      'CORS allowed origin',
      ALLOWED_ORIGIN && ALLOWED_ORIGIN !== '*' ? 'ready' : 'warning',
      ALLOWED_ORIGIN && ALLOWED_ORIGIN !== '*' ? `Allowed origin is ${ALLOWED_ORIGIN}.` : 'CORS allows every origin.',
      ALLOWED_ORIGIN && ALLOWED_ORIGIN !== '*' ? '' : 'Set NOCLICK_ALLOWED_ORIGIN to the production app URL before public launch.',
    ),
    readinessItem(
      'GOOGLE_OAUTH_VERIFICATION',
      'google',
      'Google OAuth public verification',
      'manual',
      'Google Console verification status cannot be checked from this server.',
      'Before public launch, complete Google OAuth app verification or keep the app in Testing with explicit test users.',
    ),
    readinessItem(
      'GMAIL_SCOPE_MODE',
      'google',
      'Gmail OAuth scope mode',
      ENABLE_GMAIL_DRAFTS ? 'warning' : 'ready',
      ENABLE_GMAIL_DRAFTS
        ? 'Gmail draft mode is enabled and requests gmail.compose, a restricted Gmail scope.'
        : 'Public default uses gmail.send only for Gmail execution and prepares non-send drafts inside NoClick AI.',
      ENABLE_GMAIL_DRAFTS ? 'Disable NOCLICK_ENABLE_GMAIL_DRAFTS for public launch unless restricted scope verification is planned.' : '',
    ),
    ...(await publicReviewReadinessItems()),
    ...(await releaseReadinessItems()),
    ...connectorReadinessItems(store, userId),
    envConfiguredItem('STRIPE_SECRET_KEY', 'billing', 'Stripe secret key'),
    envConfiguredItem('STRIPE_PRICE_ID', 'billing', 'Stripe recurring price'),
    envConfiguredItem('STRIPE_WEBHOOK_SECRET', 'billing', 'Stripe webhook secret'),
    readinessItem(
      'NOCLICK_REQUIRE_SUBSCRIPTION',
      'billing',
      'Subscription enforcement',
      REQUIRE_SUBSCRIPTION ? 'ready' : 'warning',
      REQUIRE_SUBSCRIPTION ? 'Subscription enforcement is enabled.' : 'Subscription enforcement is disabled.',
      REQUIRE_SUBSCRIPTION ? '' : 'Set NOCLICK_REQUIRE_SUBSCRIPTION=true when paid access should be required.',
    ),
    readinessItem(
      'ANDROID_RELEASE_SIGNING',
      'apps',
      'Android release signing',
      'manual',
      'Android Play signing cannot be verified from the web server.',
      'Build a signed AAB in Android Studio and upload it to Play Console.',
    ),
    readinessItem(
      'WINDOWS_CODE_SIGNING',
      'apps',
      'Windows installer code signing',
      'manual',
      'Windows code-signing certificate cannot be verified from the web server.',
      'Configure electron-builder signing credentials before public Windows distribution.',
    ),
  ]

  const summary = {
    ready: items.filter((item) => item.status === 'ready').length,
    missing: items.filter((item) => item.status === 'missing').length,
    warning: items.filter((item) => item.status === 'warning').length,
    manual: items.filter((item) => item.status === 'manual').length,
    total: items.length,
  }

  return {
    ok: true,
    productionReady: summary.missing === 0 && summary.warning === 0 && summary.manual === 0,
    generatedAt: new Date().toISOString(),
    publicAppUrl: PUBLIC_APP_URL,
    serverBaseUrl: SERVER_BASE_URL,
    release: {
      tag: RELEASE_TAG,
      pageUrl: RELEASE_PAGE_URL,
      downloadsUrl: `${PUBLIC_APP_URL}/downloads`,
      assets: RELEASE_ASSETS.map((asset) => ({
        id: asset.id,
        label: asset.label,
        fileName: asset.fileName,
        url: releaseAssetUrl(asset),
      })),
    },
    summary,
    items,
  }
}

function oauthProviderFromConnector(providerId) {
  return PROVIDER_ALIASES[providerId] || providerId
}

function buildOAuthUrl(store, userId, providerId) {
  const providerKey = oauthProviderFromConnector(providerId)
  const provider = OAUTH_PROVIDERS[providerKey]
  const user = store.users[userId]
  if (!provider || !provider.clientId || !provider.clientSecret) {
    const error = new Error('connector_not_configured')
    error.statusCode = 400
    throw error
  }

  const state = crypto.randomBytes(24).toString('base64url')
  store.oauthStates[hashSecret(state)] = {
    userId,
    provider: providerKey,
    requestedConnector: providerId,
    createdAt: new Date().toISOString(),
  }

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    response_type: 'code',
    state,
  })

  if (providerKey === 'google') {
    params.set('scope', provider.scopes.join(' '))
    params.set('access_type', 'offline')
    params.set('prompt', 'consent')
    params.set('include_granted_scopes', 'true')
    if (user?.email) params.set('login_hint', user.email)
  }

  if (providerKey === 'notion') {
    params.set('owner', 'user')
  }

  if (providerKey === 'slack') {
    params.set('scope', provider.scopes.join(','))
  }

  if (providerKey === 'kakao') {
    params.set('scope', provider.scopes.join(' '))
  }

  return `${provider.authUrl}?${params.toString()}`
}

function decodeJwtPayload(token) {
  if (!token) return {}
  const parts = String(token).split('.')
  if (parts.length < 2) return {}
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

async function fetchGoogleProfile(accessToken, idToken) {
  const idPayload = decodeJwtPayload(idToken)
  if (idPayload.email) {
    return {
      googleEmail: String(idPayload.email),
      googleEmailVerified: Boolean(idPayload.email_verified),
    }
  }

  try {
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return {
      googleEmail: String(profile.email || ''),
      googleEmailVerified: Boolean(profile.email_verified),
    }
  } catch {
    return {}
  }
}

async function exchangeOAuthCode(providerKey, code) {
  const provider = OAUTH_PROVIDERS[providerKey]
  if (!provider) throw new Error('unknown_provider')

  if (providerKey === 'google') {
    const body = new URLSearchParams({
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri,
      grant_type: 'authorization_code',
    })
    const result = await fetchJson(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const profile = await fetchGoogleProfile(result.access_token, result.id_token)
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : null,
      scopes: String(result.scope || '').split(' ').filter(Boolean),
      metadata: { tokenType: result.token_type, ...profile },
    }
  }

  if (providerKey === 'notion') {
    const result = await fetchJson(provider.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: provider.redirectUri,
      }),
    })
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: null,
      scopes: [],
      metadata: {
        workspaceId: result.workspace_id,
        workspaceName: result.workspace_name,
        botId: result.bot_id,
        owner: result.owner,
      },
    }
  }

  if (providerKey === 'slack') {
    const body = new URLSearchParams({
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri,
    })
    const result = await fetchJson(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!result.ok) throw new Error(result.error || 'slack_oauth_failed')
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : null,
      scopes: String(result.scope || '').split(',').filter(Boolean),
      metadata: { team: result.team, enterprise: result.enterprise, botUserId: result.bot_user_id },
    }
  }

  if (providerKey === 'kakao') {
    const body = new URLSearchParams({
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri,
      grant_type: 'authorization_code',
    })
    const result = await fetchJson(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : null,
      scopes: String(result.scope || '').split(' ').filter(Boolean),
      metadata: { tokenType: result.token_type },
    }
  }

  throw new Error('unsupported_provider')
}

async function refreshGoogleTokenIfNeeded(store, userId) {
  const raw = getRawConnection(store, userId, 'google')
  const connection = getConnection(store, userId, 'google')
  if (!connection) return null
  if (!connection.expiresAt || new Date(connection.expiresAt).getTime() > Date.now() + 60_000) return connection
  if (!connection.refreshToken) return connection

  const provider = OAUTH_PROVIDERS.google
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: connection.refreshToken,
    grant_type: 'refresh_token',
  })
  const result = await fetchJson(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  raw.accessToken = protectToken(result.access_token)
  raw.expiresAt = result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : raw.expiresAt
  return getConnection(store, userId, 'google')
}

async function handleConnectors(request, response, url) {
  const callbackMatch = url.pathname.match(/^\/v1\/connectors\/([^/]+)\/callback$/)
  if (callbackMatch) {
    await handleOAuthCallback(request, response, url, callbackMatch[1])
    return
  }

  const store = await readStore()
  const auth = requireUserAccess(request, store)
  if (!auth) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  if (auth.paymentRequired) {
    sendJson(response, 402, { error: 'subscription_required' })
    return
  }

  if (url.pathname === '/v1/connectors' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, connectors: connectorStatuses(store, auth.user.id) })
    return
  }

  const startMatch = url.pathname.match(/^\/v1\/connectors\/([^/]+)\/start$/)
  if (startMatch && request.method === 'GET') {
    const providerId = startMatch[1]
    const startUrl = buildOAuthUrl(store, auth.user.id, providerId)
    await writeStore(store)
    sendJson(response, 200, { ok: true, url: startUrl })
    return
  }

  const disconnectMatch = url.pathname.match(/^\/v1\/connectors\/([^/]+)\/disconnect$/)
  if (disconnectMatch && request.method === 'POST') {
    const tokenProvider = oauthProviderFromConnector(disconnectMatch[1])
    if (store.connections[auth.user.id]) delete store.connections[auth.user.id][tokenProvider]
    await writeStore(store)
    sendJson(response, 200, { ok: true, connectors: connectorStatuses(store, auth.user.id) })
    return
  }

  sendJson(response, 404, { error: 'not_found' })
}

async function handleOAuthCallback(request, response, url, providerKey) {
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    redirect(
      response,
      `${PUBLIC_APP_URL}?connector=${encodeURIComponent(providerKey)}&status=failed&reason=${encodeURIComponent(oauthError)}`,
    )
    return
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    redirect(response, `${PUBLIC_APP_URL}?connector=${encodeURIComponent(providerKey)}&status=missing_code`)
    return
  }

  const store = await readStore()
  const stateHash = hashSecret(state)
  const stateRecord = store.oauthStates[stateHash]
  if (!stateRecord || stateRecord.provider !== providerKey) {
    redirect(response, `${PUBLIC_APP_URL}?connector=${encodeURIComponent(providerKey)}&status=invalid_state`)
    return
  }

  try {
    const tokenPayload = await exchangeOAuthCode(providerKey, code)
    saveConnection(store, stateRecord.userId, providerKey, tokenPayload)
    delete store.oauthStates[stateHash]
    await writeStore(store)
    redirect(response, `${PUBLIC_APP_URL}?connector=${encodeURIComponent(stateRecord.requestedConnector)}&status=connected`)
  } catch (error) {
    redirect(
      response,
      `${PUBLIC_APP_URL}?connector=${encodeURIComponent(providerKey)}&status=failed&reason=${encodeURIComponent(
        error instanceof Error ? error.message : 'unknown',
      )}`,
    )
  }
}

const runSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'steps'],
  properties: {
    assistantMessage: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'provider', 'action', 'detail', 'preview', 'risk', 'input'],
        properties: {
          title: { type: 'string' },
          provider: { type: 'string', enum: ['google-calendar', 'gmail', 'notion', 'slack', 'telegram', 'kakao'] },
          action: {
            type: 'string',
            enum: [
              'calendar.create_event',
              'gmail.prepare_message',
              'gmail.create_draft',
              'gmail.send_message',
              'notion.create_page',
              'slack.post_message',
              'telegram.prepare_message',
              'telegram.send_message',
              'kakao.share_text',
            ],
          },
          detail: { type: 'string' },
          preview: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high', 'blocked'] },
          input: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'description', 'when', 'to', 'subject', 'body', 'channel', 'parentPageId', 'chatId'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              when: { type: 'string' },
              to: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
              channel: { type: 'string' },
              parentPageId: { type: 'string' },
              chatId: { type: 'string' },
            },
          },
        },
      },
    },
  },
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

function statusForRisk(risk) {
  if (risk === 'low') return 'ready'
  if (risk === 'blocked') return 'blocked'
  return 'needs_approval'
}

function wantsGmailSend(prompt) {
  const text = String(prompt || '').toLowerCase()
  const mentionsMail = /gmail|email|mail|\uBA54\uC77C|\uC774\uBA54\uC77C/.test(text)
  const asksToSend = /send|deliver|\uBCF4\uB0B4|\uC804\uC1A1|\uBC1C\uC1A1/.test(text)
  return mentionsMail && asksToSend && !/draft|\uCD08\uC548/.test(text)
}

function isSimpleGmailSend(prompt) {
  const text = String(prompt || '').toLowerCase()
  const mentionsOtherApp = /calendar|schedule|meeting|notion|slack|telegram|kakao|\uC77C\uC815|\uD68C\uC758|\uBBF8\uD305|\uB178\uC158/.test(text)
  return wantsGmailSend(text) && !mentionsOtherApp
}

function wantsKakaoShare(prompt) {
  return /kakao|kakaotalk|\uCE74\uCE74\uC624|\uCE74\uD1A1|\uCE74\uCE74\uC624\uD1A1/i.test(String(prompt || ''))
}

function wantsTelegramShare(prompt) {
  return /telegram|\uD154\uB808\uADF8\uB7A8/i.test(String(prompt || ''))
}

function extractFirstEmail(value) {
  return String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
}

function extractPromptLabel(prompt, label) {
  const match = String(prompt || '').match(new RegExp(`${label}\\s*:?\\s*([^\\n.]+)`, 'i'))
  return match?.[1]?.trim() || ''
}

function extractPromptTail(prompt, label) {
  const match = String(prompt || '').match(new RegExp(`${label}\\s*:?\\s*([\\s\\S]+)$`, 'i'))
  return match?.[1]?.trim() || ''
}

function normalizeActionRisk(action, risk) {
  if (risk === 'blocked') return risk
  return ['gmail.send_message', 'slack.post_message', 'telegram.send_message'].includes(action) ? 'high' : risk
}

function sanitizeStep(step, index, prompt = '') {
  const provider = ALLOWED_ACTIONS[step.provider] ? step.provider : 'notion'
  let action = ALLOWED_ACTIONS[provider].includes(step.action) ? step.action : ALLOWED_ACTIONS[provider][0]
  if (provider === 'gmail' && action === 'gmail.create_draft' && !ENABLE_GMAIL_DRAFTS) {
    action = 'gmail.prepare_message'
  }
  if (provider === 'gmail' && action !== 'gmail.send_message' && wantsGmailSend(prompt)) {
    action = 'gmail.send_message'
  }
  const risk = normalizeActionRisk(action, ['low', 'medium', 'high', 'blocked'].includes(step.risk) ? step.risk : 'medium')
  return {
    id: `step_${index + 1}`,
    title: String(step.title || action),
    provider,
    action,
    detail: String(step.detail || ''),
    preview: String(step.preview || ''),
    risk,
    status: statusForRisk(risk),
    input: normalizeStepInput(step.input || {}),
    result: null,
  }
}

function normalizeStepInput(input) {
  return {
    title: String(input.title || ''),
    description: String(input.description || ''),
    when: String(input.when || ''),
    to: String(input.to || ''),
    subject: String(input.subject || ''),
    body: String(input.body || ''),
    channel: String(input.channel || ''),
    parentPageId: String(input.parentPageId || ''),
    chatId: String(input.chatId || ''),
  }
}

function createFallbackRun(userId, prompt) {
  const normalized = String(prompt || '').trim()
  const lower = normalized.toLowerCase()
  const needsMeeting = normalized.includes('회의') || normalized.includes('미팅') || lower.includes('meeting')
  const needsNotice = normalized.includes('공지') || normalized.includes('알림') || normalized.includes('팀')
  const needsMailSend = wantsGmailSend(normalized)
  const mailAction = needsMailSend ? 'gmail.send_message' : ENABLE_GMAIL_DRAFTS ? 'gmail.create_draft' : 'gmail.prepare_message'
  const mailDraftTitle = ENABLE_GMAIL_DRAFTS ? '메일 초안 생성' : '메일 검토 초안 준비'

  const steps = [
    sanitizeStep(
      {
        title: needsMeeting ? '회의 일정 초안 생성' : '마감 일정 생성',
        provider: 'google-calendar',
        action: 'calendar.create_event',
        detail: '요청에서 날짜와 목적을 추출해 캘린더 일정을 만듭니다.',
        preview: normalized,
        risk: 'medium',
        input: {
          title: needsMeeting ? '회의' : 'NoClick AI 작업',
          description: normalized,
          when: '',
          to: '',
          subject: '',
          body: '',
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      0,
    ),
    sanitizeStep(
      {
        title: needsMailSend ? '메일 발송' : needsNotice ? `공지/${mailDraftTitle}` : mailDraftTitle,
        provider: 'gmail',
        action: mailAction,
        detail: needsMailSend
          ? '승인 후 Gmail에서 실제 메일을 발송합니다.'
          : ENABLE_GMAIL_DRAFTS
            ? 'Gmail에 사용자 검토용 초안을 만듭니다.'
            : 'Gmail 제한 범위를 피하기 위해 앱 안에서 검토용 메일 초안을 준비합니다.',
        preview: `${normalized}\n\n${needsMailSend ? '승인 후 위 내용을 바탕으로 메일을 발송합니다.' : '위 내용을 바탕으로 검토용 초안을 작성합니다.'}`,
        risk: needsMailSend ? 'high' : 'low',
        input: {
          title: '',
          description: '',
          when: '',
          to: '',
          subject: needsNotice ? '업무 공지' : 'NoClick AI 초안',
          body: normalized,
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      1,
      normalized,
    ),
    sanitizeStep(
      {
        title: 'Notion 작업 페이지 생성',
        provider: 'notion',
        action: 'notion.create_page',
        detail: '요청과 실행 체크리스트를 Notion 페이지로 정리합니다.',
        preview: normalized,
        risk: 'low',
        input: {
          title: 'NoClick AI 실행 계획',
          description: normalized,
          when: '',
          to: '',
          subject: '',
          body: normalized,
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      2,
      normalized,
    ),
  ]

  return {
    id: `run_${crypto.randomBytes(10).toString('hex')}`,
    userId,
    prompt: normalized,
    status: steps.some((step) => step.status === 'needs_approval') ? 'needs_approval' : 'ready',
    assistantMessage: '요청을 실행 단계로 나눴습니다. 연결이 필요한 앱은 먼저 연결하고, 승인 단계는 승인 후 실행하세요.',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createGmailSendRun(userId, prompt) {
  const normalized = String(prompt || '').trim()
  const explicitRecipient = extractFirstEmail(normalized)
  const subject = extractPromptLabel(normalized, 'subject') || 'NoClick AI message'
  const body =
    extractPromptTail(normalized, 'body') ||
    `NoClick AI verification message.\n\nOriginal request:\n${normalized}`
  const steps = [
    sanitizeStep(
      {
        title: 'Gmail 메일 발송',
        provider: 'gmail',
        action: 'gmail.send_message',
        detail: '승인 후 Gmail에서 실제 메일을 발송합니다.',
        preview: body,
        risk: 'high',
        input: {
          title: '',
          description: '',
          when: '',
          to: explicitRecipient,
          subject,
          body,
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      0,
      normalized,
    ),
  ]

  return {
    id: `run_${crypto.randomBytes(10).toString('hex')}`,
    userId,
    prompt: normalized,
    status: 'needs_approval',
    assistantMessage: '메일 발송 계획을 만들었습니다. 수신자, 제목, 내용을 확인한 뒤 승인하고 실행하세요.',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createKakaoShareRun(userId, prompt) {
  const normalized = String(prompt || '').trim()
  const steps = [
    sanitizeStep(
      {
        title: 'KakaoTalk 공유 텍스트 준비',
        provider: 'kakao',
        action: 'kakao.share_text',
        detail: 'KakaoTalk 직접 API 전송 대신 Android 공유창 또는 클립보드 fallback으로 보낼 텍스트를 준비합니다.',
        preview: normalized,
        risk: 'low',
        input: {
          title: '',
          description: '',
          when: '',
          to: '',
          subject: '',
          body: normalized,
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      0,
      normalized,
    ),
  ]

  return {
    id: `run_${crypto.randomBytes(10).toString('hex')}`,
    userId,
    prompt: normalized,
    status: 'ready',
    assistantMessage: 'KakaoTalk 공유용 텍스트를 준비했습니다. 실행 후 공유 버튼으로 Android 공유창이나 클립보드 fallback을 사용할 수 있습니다.',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createTelegramShareRun(userId, prompt) {
  const normalized = String(prompt || '').trim()
  const steps = [
    sanitizeStep(
      {
        title: 'Telegram 공유 텍스트 준비',
        provider: 'telegram',
        action: 'telegram.prepare_message',
        detail: 'Telegram Bot API 전송 대신 Android 공유창 또는 클립보드 fallback으로 보낼 텍스트를 준비합니다.',
        preview: normalized,
        risk: 'low',
        input: {
          title: '',
          description: '',
          when: '',
          to: '',
          subject: '',
          body: normalized,
          channel: '',
          parentPageId: '',
          chatId: '',
        },
      },
      0,
      normalized,
    ),
  ]

  return {
    id: `run_${crypto.randomBytes(10).toString('hex')}`,
    userId,
    prompt: normalized,
    status: 'ready',
    assistantMessage: 'Telegram 공유용 텍스트를 준비했습니다. 실행 후 공유 버튼으로 Android 공유창이나 클립보드 fallback을 사용할 수 있습니다.',
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function createAiRun(user, prompt) {
  const userId = user.id
  if (wantsKakaoShare(prompt)) return createKakaoShareRun(userId, prompt)
  if (wantsTelegramShare(prompt)) return createTelegramShareRun(userId, prompt)
  if (isSimpleGmailSend(prompt)) return createGmailSendRun(userId, prompt)
  if (!OPENAI_API_KEY) return createFallbackRun(userId, prompt)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS)
  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: `You are NoClick AI. Convert Korean chat requests into safe automation tool calls. Prefer Google Calendar event creation and ${
            ENABLE_GMAIL_DRAFTS ? 'Gmail draft creation with gmail.create_draft' : 'NoClick AI email review drafts with gmail.prepare_message'
          } when the request mentions schedules, meetings, invitations, or email drafts. Use gmail.send_message only when the user explicitly asks to send/deliver an email now; otherwise use ${
            ENABLE_GMAIL_DRAFTS ? 'gmail.create_draft' : 'gmail.prepare_message'
          }. For calendar steps, put input.when as an ISO 8601 date-time with timezone. For Gmail steps, put input.to as an email address; if the user says "나에게", "내게", "본인에게", "me", or "myself", use the current user email. Never execute payment, transfer, account deletion, password change, or mass personal data submission; mark those steps blocked. Gmail sending and high-risk message sending require approval.`,
        },
        {
          role: 'user',
          content: `현재 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n현재 사용자 이메일: ${user.email}\n사용자 요청: ${prompt}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'noclick_run',
          strict: true,
          schema: runSchema,
        },
      },
    }),
  }).catch(() => null)
  clearTimeout(timeout)
  if (!openAiResponse) return createFallbackRun(userId, prompt)

  const body = await openAiResponse.json().catch(() => ({}))
  if (!openAiResponse.ok) return createFallbackRun(userId, prompt)
  let payload
  try {
    payload = JSON.parse(extractOutputText(body))
  } catch {
    return createFallbackRun(userId, prompt)
  }
  const steps = payload.steps.map((step, index) => sanitizeStep(step, index, prompt))

  return {
    id: `run_${crypto.randomBytes(10).toString('hex')}`,
    userId,
    prompt,
    status: steps.some((step) => step.status === 'needs_approval') ? 'needs_approval' : 'ready',
    assistantMessage: payload.assistantMessage,
    steps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function createAiPlan(request) {
  const body = await readBody(request)
  const openAiKey = String(request.headers['x-openai-key'] || OPENAI_API_KEY).trim()
  const prompt = String(body.prompt || '').trim()
  const localeNow = String(body.localeNow || new Date().toISOString())

  if (!openAiKey) return { status: 400, body: { error: 'openai_key_required' } }
  if (!prompt) return { status: 400, body: { error: 'prompt_required' } }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS)
  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
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
  }).catch(() => null)
  clearTimeout(timeout)
  if (!openAiResponse) {
    return {
      status: 504,
      body: {
        error: 'openai_request_timeout',
        detail: 'OpenAI planning request timed out.',
      },
    }
  }

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

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error_description || body.error?.message || body.error || response.statusText)
    error.statusCode = response.status
    error.body = body
    throw error
  }
  return body
}

function getSeoulDateParts(date = new Date()) {
  const values = {}
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)

  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value)
    }
  }

  return values
}

function createSeoulDate(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0))
}

function validClockTime(hour, minute) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function parseCalendarClock(text) {
  const source = String(text || '')
  const lower = source.toLowerCase()

  let match = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2] || 0)
    const meridiem = match[3][0]
    if (meridiem === 'p' && hour < 12) hour += 12
    if (meridiem === 'a' && hour === 12) hour = 0
    return validClockTime(hour, minute)
  }

  match = source.match(/\uC624\uC804\s*(\d{1,2})(?:\s*\uC2DC)?(?:\s*(\d{1,2})\s*\uBD84?)?/)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2] || 0)
    if (hour === 12) hour = 0
    return validClockTime(hour, minute)
  }

  match = source.match(/\uC624\uD6C4\s*(\d{1,2})(?:\s*\uC2DC)?(?:\s*(\d{1,2})\s*\uBD84?)?/)
  if (match) {
    let hour = Number(match[1])
    const minute = Number(match[2] || 0)
    if (hour < 12) hour += 12
    return validClockTime(hour, minute)
  }

  match = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/)
  if (match) return validClockTime(Number(match[1]), Number(match[2] || 0))

  match = source.match(/(\d{1,2})\s*\uC2DC(?:\s*(\d{1,2})\s*\uBD84?)?/)
  if (match) return validClockTime(Number(match[1]), Number(match[2] || 0))

  match = lower.match(/\b(\d{1,2}):(\d{2})\b/)
  if (match) return validClockTime(Number(match[1]), Number(match[2]))

  return null
}

function parseCalendarDayOffset(text) {
  const source = String(text || '')
  const lower = source.toLowerCase()

  if (/\uBAA8\uB808/.test(source) || /\bday after tomorrow\b/.test(lower)) return 2
  if (/\uB0B4\uC77C/.test(source) || /\btomorrow\b/.test(lower)) return 1
  if (/\uC624\uB298/.test(source) || /\btoday\b/.test(lower)) return 0
  if (/\uB2E4\uC74C\s*\uC8FC/.test(source) || /\bnext week\b/.test(lower)) return 7

  const inDays = lower.match(/\bin\s+(\d{1,2})\s+days?\b/)
  if (inDays) return Number(inDays[1])

  return null
}

function parseCalendarDateLiteral(text) {
  const source = String(text || '')
  let match = source.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  }

  match = source.match(/(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/)
  if (match) {
    return { ...getSeoulDateParts(), month: Number(match[1]), day: Number(match[2]) }
  }

  return null
}

function parseCalendarStart(value, prompt = '') {
  const raw = String(value || '').trim()
  if (raw) {
    const start = new Date(raw)
    if (Number.isFinite(start.getTime())) return start
  }

  const text = [raw, prompt].filter(Boolean).join(' ')
  const clock = parseCalendarClock(text) || { hour: 9, minute: 0 }
  const dateLiteral = parseCalendarDateLiteral(text)
  if (dateLiteral) return createSeoulDate(dateLiteral.year, dateLiteral.month, dateLiteral.day, clock.hour, clock.minute)

  const dayOffset = parseCalendarDayOffset(text)
  if (dayOffset !== null) {
    const today = getSeoulDateParts()
    return createSeoulDate(today.year, today.month, today.day + dayOffset, clock.hour, clock.minute)
  }

  if (!raw) return new Date(Date.now() + 60 * 60 * 1000)
  return null
}

function isSelfAddressed(prompt) {
  return /나에게|내게|본인에게|me|myself/i.test(String(prompt || ''))
}

function resolveGmailRecipient(store, run, step) {
  const explicit = String(step.input.to || '').trim()
  if (explicit) return explicit
  const googleEmail = getConnection(store, run.userId, 'google')?.metadata?.googleEmail || ''
  return isSelfAddressed(run.prompt) ? googleEmail || store.users[run.userId]?.email || '' : ''
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function isValidRecipientList(value) {
  const recipients = String(value || '')
    .split(/[;,]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean)
  return recipients.length > 0 && recipients.every(isValidEmailAddress)
}

function createRawEmail({ recipient, subject, body }) {
  return Buffer.from(
    [
      `To: ${recipient}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
    ].join('\r\n'),
    'utf8',
  ).toString('base64url')
}

async function executeGoogleCalendar(store, run, step) {
  const connection = await refreshGoogleTokenIfNeeded(store, run.userId)
  if (!connection?.accessToken) return executionFailure('connection_required', 'Google 연결이 필요합니다.')

  const start = parseCalendarStart(step.input.when, run.prompt)
  if (!start) return executionFailure('invalid_event_time', 'Calendar 일정 시간이 ISO 8601 형식이 아니어서 실행할 수 없습니다.')
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const event = await fetchJson('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: step.input.title || step.title,
      description: step.input.description || run.prompt,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    }),
  })
  return { ok: true, message: 'Google Calendar 일정이 생성되었습니다.', externalId: event.id, link: event.htmlLink }
}

async function executeGmailDraft(store, run, step) {
  if (!ENABLE_GMAIL_DRAFTS) return executeGmailPrepared(store, run, step)
  const connection = await refreshGoogleTokenIfNeeded(store, run.userId)
  if (!connection?.accessToken) return executionFailure('connection_required', 'Gmail 연결이 필요합니다.')
  const recipient = resolveGmailRecipient(store, run, step)
  if (!recipient) return executionFailure('recipient_required', '메일 수신자가 필요합니다.')
  if (!isValidRecipientList(recipient)) return executionFailure('invalid_recipient', '메일 수신자 이메일 형식이 올바르지 않습니다.')

  const subject = step.input.subject || step.title
  const body = step.input.body || step.input.description || run.prompt
  const raw = createRawEmail({ recipient, subject, body })

  const draft = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  })
  return { ok: true, message: 'Gmail 초안이 생성되었습니다.', externalId: draft.id }
}

async function executeGmailPrepared(_store, run, step) {
  const subject = step.input.subject || step.title
  const body = step.input.body || step.input.description || step.preview || run.prompt
  const recipient = resolveGmailRecipient(_store, run, step)
  return {
    ok: true,
    message: '검토용 메일 초안이 NoClick AI 안에 준비되었습니다.',
    shareText: [`To: ${recipient || '(recipient needed)'}`, `Subject: ${subject}`, '', body].join('\n'),
  }
}

async function executeGmailSend(store, run, step) {
  const connection = await refreshGoogleTokenIfNeeded(store, run.userId)
  if (!connection?.accessToken) return executionFailure('connection_required', 'Gmail 연결이 필요합니다.')
  const recipient = resolveGmailRecipient(store, run, step)
  if (!recipient) return executionFailure('recipient_required', '메일 수신자가 필요합니다.')
  if (!isValidRecipientList(recipient)) return executionFailure('invalid_recipient', '메일 수신자 이메일 형식이 올바르지 않습니다.')

  const subject = step.input.subject || step.title
  const body = step.input.body || step.input.description || step.preview || run.prompt
  const message = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: createRawEmail({ recipient, subject, body }) }),
  })
  return {
    ok: true,
    message: 'Gmail 메일이 발송되었습니다.',
    externalId: message.id,
    threadId: message.threadId,
  }
}

async function executeNotionPage(store, run, step) {
  const connection = getConnection(store, run.userId, 'notion')
  if (!connection?.accessToken) return executionFailure('connection_required', 'Notion 연결이 필요합니다.')

  const parentPageId = step.input.parentPageId || process.env.NOTION_PARENT_PAGE_ID || process.env.NOCLICK_NOTION_PARENT_PAGE_ID
  if (!parentPageId) return executionFailure('parent_page_required', 'Notion parent page ID가 필요합니다.')

  const page = await fetchJson('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: step.input.title || step.title } }],
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: step.input.body || step.input.description || run.prompt } }],
          },
        },
      ],
    }),
  })
  return { ok: true, message: 'Notion 페이지가 생성되었습니다.', externalId: page.id, link: page.url }
}

async function executeSlackMessage(store, run, step) {
  const connection = getConnection(store, run.userId, 'slack')
  if (!connection?.accessToken) return executionFailure('connection_required', 'Slack 연결이 필요합니다.')

  const channel = step.input.channel || process.env.SLACK_DEFAULT_CHANNEL_ID
  if (!channel) return executionFailure('channel_required', 'Slack 채널 ID가 필요합니다.')

  const result = await fetchJson('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text: step.input.body || step.preview || run.prompt,
    }),
  })
  if (!result.ok) return executionFailure(result.error || 'slack_error', result.error || 'Slack 메시지 전송 실패')
  return { ok: true, message: 'Slack 메시지가 전송되었습니다.', externalId: result.ts, channel: result.channel }
}

async function executeTelegramMessage(_store, run, step) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = step.input.chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID
  if (!botToken || !chatId) return executeTelegramPrepared(_store, run, step)

  const result = await fetchJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: step.input.body || step.preview || run.prompt,
    }),
  })
  return { ok: true, message: 'Telegram 메시지가 전송되었습니다.', externalId: result.result?.message_id }
}

async function executeTelegramPrepared(_store, run, step) {
  return {
    ok: true,
    code: 'share_prepared',
    message: 'Telegram 공유용 텍스트가 NoClick AI 안에 준비되었습니다. 공유 버튼으로 전송하세요.',
    shareText: step.input.body || step.preview || run.prompt,
  }
}

async function executeKakaoShare(_store, run, step) {
  return {
    ok: true,
    code: 'share_prepared',
    message: 'KakaoTalk 공유용 텍스트가 NoClick AI 안에 준비되었습니다. 공유 버튼으로 전송하세요.',
    shareText: step.input.body || step.preview || run.prompt,
  }
}

function executionFailure(code, message) {
  return { ok: false, code, message }
}

function auditStepSnapshot(step) {
  return {
    stepId: step.id,
    provider: step.provider,
    action: step.action,
    title: step.title,
    risk: step.risk,
    status: step.status,
    to: step.provider === 'gmail' ? String(step.input?.to || '') : '',
    subject: step.provider === 'gmail' ? String(step.input?.subject || '') : '',
  }
}

function appendAuditLog(store, userId, event) {
  const id = `audit_${crypto.randomBytes(10).toString('hex')}`
  const log = {
    id,
    userId,
    createdAt: new Date().toISOString(),
    ...event,
  }
  store.auditLogs[id] = log
  return log
}

function userAuditLogs(store, userId) {
  return Object.values(store.auditLogs || {})
    .filter((log) => log.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50)
}

function highRiskExecutableSteps(run) {
  return run.steps.filter(
    (step) =>
      step.risk === 'high' &&
      step.status !== 'blocked' &&
      step.status !== 'done' &&
      step.status !== 'failed' &&
      step.status !== 'needs_approval',
  )
}

function needsHighRiskExecutionConfirmation(run) {
  return highRiskExecutableSteps(run).length > 0
}

async function executeStep(store, run, step) {
  if (step.provider === 'google-calendar') return executeGoogleCalendar(store, run, step)
  if (step.provider === 'gmail' && step.action === 'gmail.send_message') return executeGmailSend(store, run, step)
  if (step.provider === 'gmail' && step.action === 'gmail.create_draft') return executeGmailDraft(store, run, step)
  if (step.provider === 'gmail') return executeGmailPrepared(store, run, step)
  if (step.provider === 'notion') return executeNotionPage(store, run, step)
  if (step.provider === 'slack') return executeSlackMessage(store, run, step)
  if (step.provider === 'telegram' && step.action === 'telegram.prepare_message') return executeTelegramPrepared(store, run, step)
  if (step.provider === 'telegram') return executeTelegramMessage(store, run, step)
  if (step.provider === 'kakao') return executeKakaoShare(store, run, step)
  return executionFailure('unsupported_provider', '지원하지 않는 커넥터입니다.')
}

async function executeRun(store, run) {
  for (const step of run.steps) {
    if (step.status === 'blocked' || step.status === 'done' || step.status === 'failed') continue
    if (step.status === 'needs_approval') continue

    step.status = 'running'
    let result
    try {
      result = await executeStep(store, run, step)
    } catch (error) {
      result = executionFailure('external_api_error', error instanceof Error ? error.message : '외부 API 실행 중 오류가 발생했습니다.')
    }
    step.result = result
    step.status = result.ok ? 'done' : 'failed'
    appendAuditLog(store, run.userId, {
      type: 'step_executed',
      runId: run.id,
      step: auditStepSnapshot(step),
      result: {
        ok: Boolean(result.ok),
        code: result.code || '',
        message: result.message || '',
        externalId: result.externalId || '',
        threadId: result.threadId || '',
        link: result.link || '',
      },
    })
  }

  const pendingApproval = run.steps.some((step) => step.status === 'needs_approval')
  const failed = run.steps.some((step) => step.status === 'failed')
  const running = run.steps.some((step) => step.status === 'running')
  run.status = running ? 'running' : pendingApproval ? 'needs_approval' : failed ? 'failed' : 'done'
  run.updatedAt = new Date().toISOString()
  return run
}

function approveRun(run, stepId) {
  run.steps = run.steps.map((step) => {
    if (step.status !== 'needs_approval') return step
    if (stepId && step.id !== stepId) return step
    return { ...step, status: 'approved' }
  })
  run.status = run.steps.some((step) => step.status === 'needs_approval') ? 'needs_approval' : 'ready'
  run.updatedAt = new Date().toISOString()
  return run
}

function userRuns(store, userId) {
  return Object.values(store.runs)
    .filter((run) => run.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
}

async function handleRuns(request, response, url) {
  const store = await readStore()
  const auth = requireUserAccess(request, store)
  if (!auth) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  if (auth.paymentRequired) {
    sendJson(response, 402, { error: 'subscription_required' })
    return
  }

  if (url.pathname === '/v1/runs' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, runs: userRuns(store, auth.user.id) })
    return
  }

  if (url.pathname === '/v1/runs/audit-logs' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, auditLogs: userAuditLogs(store, auth.user.id) })
    return
  }

  if (url.pathname === '/v1/runs' && request.method === 'POST') {
    const body = await readBody(request)
    const prompt = String(body.prompt || '').trim()
    if (!prompt) {
      sendJson(response, 400, { error: 'prompt_required' })
      return
    }
    const run = await createAiRun(auth.user, prompt)
    store.runs[run.id] = run
    await writeStore(store)
    sendJson(response, 201, { ok: true, run })
    return
  }

  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)(?:\/([^/]+))?$/)
  if (!runMatch) {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  const run = store.runs[runMatch[1]]
  if (!run || run.userId !== auth.user.id) {
    sendJson(response, 404, { error: 'run_not_found' })
    return
  }

  if (!runMatch[2] && request.method === 'GET') {
    sendJson(response, 200, { ok: true, run })
    return
  }

  if (runMatch[2] === 'approve' && request.method === 'POST') {
    const body = await readBody(request)
    const before = run.steps.map((step) => ({ ...step }))
    approveRun(run, body.stepId ? String(body.stepId) : '')
    const approvedSteps = run.steps.filter(
      (step) =>
        step.status === 'approved' &&
        before.some((previous) => previous.id === step.id && previous.status === 'needs_approval'),
    )
    if (approvedSteps.length) {
      appendAuditLog(store, auth.user.id, {
        type: 'steps_approved',
        runId: run.id,
        steps: approvedSteps.map(auditStepSnapshot),
      })
    }
    await writeStore(store)
    sendJson(response, 200, { ok: true, run })
    return
  }

  if (runMatch[2] === 'execute' && request.method === 'POST') {
    const body = await readBody(request)
    if (needsHighRiskExecutionConfirmation(run) && body.confirmHighRisk !== true) {
      sendJson(response, 409, {
        error: 'high_risk_confirmation_required',
        steps: highRiskExecutableSteps(run).map(auditStepSnapshot),
      })
      return
    }
    await executeRun(store, run)
    await writeStore(store)
    sendJson(response, 200, { ok: true, run })
    return
  }

  sendJson(response, 405, { error: 'method_not_allowed' })
}

function looksLikeApproval(message) {
  return /승인|좋아|진행|실행|go|approve/i.test(message)
}

function looksLikeExecuteOnly(message) {
  return /실행|시작|run/i.test(message) && !/승인/i.test(message)
}

async function handleChat(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' })
    return
  }

  const store = await readStore()
  const auth = requireUserAccess(request, store)
  if (!auth) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  if (auth.paymentRequired) {
    sendJson(response, 402, { error: 'subscription_required' })
    return
  }

  const body = await readBody(request)
  const message = String(body.message || '').trim()
  const runId = String(body.runId || '').trim()
  if (!message) {
    sendJson(response, 400, { error: 'message_required' })
    return
  }

  if (runId && store.runs[runId]?.userId === auth.user.id && looksLikeApproval(message)) {
    const run = store.runs[runId]
    const before = run.steps.map((step) => ({ ...step }))
    approveRun(run, '')
    const approvedSteps = run.steps.filter(
      (step) =>
        step.status === 'approved' &&
        before.some((previous) => previous.id === step.id && previous.status === 'needs_approval'),
    )
    if (approvedSteps.length) {
      appendAuditLog(store, auth.user.id, {
        type: 'steps_approved',
        runId: run.id,
        steps: approvedSteps.map(auditStepSnapshot),
      })
    }
    const shouldExecute = looksLikeExecuteOnly(message) || /실행/.test(message)
    if (shouldExecute && !needsHighRiskExecutionConfirmation(run)) await executeRun(store, run)
    await writeStore(store)
    sendJson(response, 200, {
      ok: true,
      assistantMessage:
        run.status === 'done'
          ? '승인된 작업을 실행했습니다.'
          : shouldExecute && needsHighRiskExecutionConfirmation(run)
            ? '위험도가 높은 작업은 실행 버튼에서 추가 확인 후 실행할 수 있습니다.'
          : '승인 가능한 단계를 승인했습니다. 이제 실행할 수 있습니다.',
      run,
      connectors: connectorStatuses(store, auth.user.id),
    })
    return
  }

  const run = await createAiRun(auth.user, message)
  store.runs[run.id] = run
  await writeStore(store)
  sendJson(response, 201, {
    ok: true,
    assistantMessage: run.assistantMessage,
    run,
    connectors: connectorStatuses(store, auth.user.id),
  })
}

export async function handleRequest(request, response) {
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
      chat: true,
      connectors: true,
      auth: true,
      billing: true,
      model: OPENAI_MODEL,
      protocol,
      serverKeyConfigured: Boolean(OPENAI_API_KEY),
      databaseConfigured: Boolean(DATABASE_URL),
      adminConfigured: ADMIN_EMAILS.size > 0,
      gmailDraftsEnabled: ENABLE_GMAIL_DRAFTS,
      stripeConfigured: stripeConfigured(),
      stripeWebhookConfigured: Boolean(STRIPE_WEBHOOK_SECRET),
      requireSubscription: REQUIRE_SUBSCRIPTION,
      storage: STORAGE_TARGET,
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

    if (url.pathname === '/v1/readiness') {
      const store = await readStore()
      const auth = requireUserAccess(request, store)
      if (!auth) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      if (auth.paymentRequired) {
        sendJson(response, 402, { error: 'subscription_required' })
        return
      }
      sendJson(response, 200, await productionReadinessReport(store, auth.user.id))
      return
    }

    if (url.pathname.startsWith('/v1/connectors')) {
      await handleConnectors(request, response, url)
      return
    }

    if (url.pathname === '/v1/chat') {
      await handleChat(request, response)
      return
    }

    if (url.pathname === '/v1/runs' || url.pathname.startsWith('/v1/runs/')) {
      await handleRuns(request, response, url)
      return
    }

    if (url.pathname !== '/v1/state' && url.pathname !== '/v1/plan') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        await sendStatic(response, url)
        return
      }
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

export function startServer() {
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer()
}
