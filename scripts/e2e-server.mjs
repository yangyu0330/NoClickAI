#!/usr/bin/env node

import { spawn } from 'node:child_process'

const WEB_PORT = '55173'
const API_PORT = '58788'
const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`

const env = {
  ...process.env,
  NOCLICK_SYNC_DATA_DIR: process.env.NOCLICK_SYNC_DATA_DIR || '.tmp/e2e-data',
  HOST: '127.0.0.1',
  PORT: API_PORT,
  NOCLICK_SYNC_TOKEN: 'e2e-sync-token-for-local-smoke-tests',
  NOCLICK_TOKEN_ENCRYPTION_KEY: 'e2e-token-encryption-key-that-is-not-the-sync-token',
  NOCLICK_PUBLIC_APP_URL: WEB_BASE_URL,
  NOCLICK_SERVER_BASE_URL: API_BASE_URL,
  NOCLICK_ALLOWED_ORIGIN: WEB_BASE_URL,
  VITE_NOCLICK_SERVER_BASE_URL: API_BASE_URL,
  NOCLICK_REQUIRE_SUBSCRIPTION: 'false',
  NOCLICK_EXPOSE_ERROR_DETAILS: 'false',
  NOCLICK_ADMIN_EMAILS: 'e2e-admin@example.com',
  DATABASE_URL: '',
  POSTGRES_URL: '',
  OPENAI_API_KEY: '',
  NOCLICK_OPENAI_MODEL: 'gpt-5-nano',
}

const children = [
  spawn(process.execPath, ['server/sync-server.mjs'], { env, stdio: 'inherit' }),
  spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', WEB_PORT, '--strictPort'], {
    env,
    stdio: 'inherit',
  }),
]

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exitCode = code
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code) shutdown(code)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
