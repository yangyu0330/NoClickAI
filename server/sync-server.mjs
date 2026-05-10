import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.NOCLICK_SYNC_DATA_DIR || join(__dirname, 'data')
const DATA_FILE = join(DATA_DIR, 'workspaces.json')
const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '127.0.0.1'
const SYNC_TOKEN = process.env.NOCLICK_SYNC_TOKEN || 'dev-sync-token'

async function readStore() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'))
  } catch {
    return { workspaces: {} }
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Workspace-Id',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function getWorkspaceId(request, url) {
  return request.headers['x-workspace-id'] || url.searchParams.get('workspaceId') || ''
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'noclick-sync', time: new Date().toISOString() })
    return
  }

  if (url.pathname !== '/v1/state') {
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
    sendJson(response, 500, { error: 'server_error', detail: error instanceof Error ? error.message : 'unknown' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`NoClick Sync server listening on http://${HOST}:${PORT}`)
  console.log('Set NOCLICK_SYNC_TOKEN in production. Current token is for local development only.')
})
