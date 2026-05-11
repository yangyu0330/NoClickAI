#!/usr/bin/env node

import { spawn } from 'node:child_process'

const baseUrl = process.env.NOCLICK_E2E_BASE_URL || process.env.NOCLICK_AUDIT_BASE_URL || 'https://noclickai-zeta.vercel.app'
const env = {
  ...process.env,
  NOCLICK_E2E_BASE_URL: baseUrl.replace(/\/+$/, ''),
  NOCLICK_E2E_API_BASE_URL: (process.env.NOCLICK_E2E_API_BASE_URL || baseUrl).replace(/\/+$/, ''),
}

const child = spawn(process.execPath, ['./node_modules/@playwright/test/cli.js', 'test'], {
  env,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exitCode = code || 0
})
