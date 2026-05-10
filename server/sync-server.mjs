import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.NOCLICK_SYNC_DATA_DIR || join(__dirname, 'data')
const DATA_FILE = join(DATA_DIR, 'workspaces.json')
const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '127.0.0.1'
const SYNC_TOKEN = process.env.NOCLICK_SYNC_TOKEN || 'dev-sync-token'
const OPENAI_MODEL = process.env.NOCLICK_OPENAI_MODEL || 'gpt-5.2'
const ALLOWED_ORIGIN = process.env.NOCLICK_ALLOWED_ORIGIN || '*'
const MAX_BODY_BYTES = 1_000_000
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 90
const buckets = new Map()

async function readStore() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'))
  } catch {
    return { workspaces: {} }
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true })
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`
  await writeFile(tempFile, JSON.stringify(store, null, 2), 'utf8')
  await rename(tempFile, DATA_FILE)
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OpenAI-Key, X-Workspace-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

function isAuthorized(request) {
  const auth = request.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const expected = Buffer.from(SYNC_TOKEN)
  const actual = Buffer.from(token)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

async function readBody(request) {
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
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function getWorkspaceId(request, url) {
  return request.headers['x-workspace-id'] || url.searchParams.get('workspaceId') || ''
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
  const openAiKey = String(request.headers['x-openai-key'] || '').trim()
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'noclick-sync',
      aiPlanner: true,
      storage: DATA_FILE,
      time: new Date().toISOString(),
    })
    return
  }

  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: 'rate_limited' })
    return
  }

  if (url.pathname !== '/v1/state' && url.pathname !== '/v1/plan') {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }

  const workspaceId = String(getWorkspaceId(request, url)).trim()
  if (!workspaceId) {
    sendJson(response, 400, { error: 'workspace_required' })
    return
  }

  try {
    if (url.pathname === '/v1/plan') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method_not_allowed' })
        return
      }
      const result = await createAiPlan(request)
      sendJson(response, result.status, result.body)
      return
    }

    const store = await readStore()

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
})

server.listen(PORT, HOST, () => {
  console.log(`NoClick Sync server listening on http://${HOST}:${PORT}`)
  console.log('Set NOCLICK_SYNC_TOKEN in production. Current token is for local development only.')
})
