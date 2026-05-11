#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const DEFAULT_BASE_URL = 'https://noclickai-zeta.vercel.app'

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.NOCLICK_AUDIT_BASE_URL || DEFAULT_BASE_URL,
    email: process.env.NOCLICK_AUDIT_EMAIL || '',
    password: process.env.NOCLICK_AUDIT_PASSWORD || '',
    token: process.env.NOCLICK_AUDIT_TOKEN || '',
    expectedCommit: process.env.NOCLICK_AUDIT_EXPECTED_COMMIT || localGitHead(),
    json: parseBoolean(process.env.NOCLICK_LAUNCH_STATUS_JSON),
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || args.baseUrl
      index += 1
      continue
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length)
      continue
    }
    if (arg === '--email') {
      args.email = argv[index + 1] || args.email
      index += 1
      continue
    }
    if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length)
      continue
    }
    if (arg === '--password') {
      args.password = argv[index + 1] || args.password
      index += 1
      continue
    }
    if (arg.startsWith('--password=')) {
      args.password = arg.slice('--password='.length)
      continue
    }
    if (arg === '--token') {
      args.token = argv[index + 1] || args.token
      index += 1
      continue
    }
    if (arg.startsWith('--token=')) {
      args.token = arg.slice('--token='.length)
      continue
    }
    if (arg === '--expected-commit') {
      args.expectedCommit = argv[index + 1] || args.expectedCommit
      index += 1
      continue
    }
    if (arg.startsWith('--expected-commit=')) {
      args.expectedCommit = arg.slice('--expected-commit='.length)
      continue
    }
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--no-json') {
      args.json = false
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, '')
  return args
}

function runGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function localGitHead() {
  return runGit(['rev-parse', 'HEAD'])
}

function localGitDirty() {
  return Boolean(runGit(['status', '--porcelain']))
}

function commitMatches(actual, expected) {
  if (!actual || !expected) return false
  return actual === expected || actual.startsWith(expected) || expected.startsWith(actual)
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  return { response, text }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })

  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${url} returned non-JSON response: ${text.slice(0, 120)}`)
  }

  return { response, body }
}

function line(status, label, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`${status.padEnd(8)} ${label}${suffix}`)
}

function readinessBlockers(readiness) {
  const items = readiness?.items || []
  const hasLaunchBlockingField = items.some((item) => typeof item.launchBlocking === 'boolean')
  return items.filter((item) => (hasLaunchBlockingField ? item.launchBlocking : item.status !== 'ready'))
}

async function createTemporaryAccount(baseUrl) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const email = `noclick-launch-${suffix}@example.com`
  const password = `LaunchPass!${suffix}`
  const { response, body } = await fetchJson(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'NoClick Launch Status' }),
  })

  if (response.status !== 201 || !body?.token) {
    throw new Error(`/v1/auth/register returned HTTP ${response.status}`)
  }

  return { email, token: body.token, temporary: true }
}

async function loginAccount(baseUrl, email, password) {
  const { response, body } = await fetchJson(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok || !body?.token) {
    throw new Error(`/v1/auth/login returned HTTP ${response.status}`)
  }

  return { email, token: body.token, temporary: false }
}

async function resolveAccount(baseUrl, args) {
  if (args.token) return { email: args.email || 'token-authenticated-account', token: args.token, temporary: false }
  if (args.email && args.password) return loginAccount(baseUrl, args.email, args.password)
  return createTemporaryAccount(baseUrl)
}

async function deleteTemporaryAccount(baseUrl, account) {
  if (!account?.temporary) return

  const { response } = await fetchJson(`${baseUrl}/v1/auth/delete-account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.token}` },
    body: JSON.stringify({ confirmEmail: account.email }),
  })

  if (!response.ok) {
    line('WARNING', 'temporary account cleanup', `/v1/auth/delete-account returned HTTP ${response.status}`)
  }
}

async function getReadiness(baseUrl, account) {
  const { response, body } = await fetchJson(`${baseUrl}/v1/readiness`, {
    headers: { Authorization: `Bearer ${account.token}` },
  })

  if (response.status === 402) {
    throw new Error('/v1/readiness requires an admin or paid account while subscription enforcement is enabled')
  }
  if (!response.ok || !body?.ok) {
    throw new Error(`/v1/readiness returned HTTP ${response.status}`)
  }

  return body
}

async function main() {
  const args = parseArgs(process.argv)
  const report = {
    baseUrl: args.baseUrl,
    expectedCommit: args.expectedCommit,
    health: null,
    readiness: null,
    blockers: [],
    warnings: [],
  }

  let account = null
  try {
    const healthResult = await fetchJson(`${args.baseUrl}/health`)
    if (!healthResult.response.ok || !healthResult.body?.ok) {
      throw new Error(`/health returned HTTP ${healthResult.response.status}`)
    }
    report.health = healthResult.body

    const actualCommit = String(report.health.commitSha || '').trim()
    if (args.expectedCommit && !commitMatches(actualCommit, args.expectedCommit)) {
      report.warnings.push(`deployed commit ${actualCommit || 'unknown'} does not match expected ${args.expectedCommit}`)
    }
    if (localGitDirty()) {
      report.warnings.push('local working tree has uncommitted changes')
    }

    account = await resolveAccount(args.baseUrl, args)
    report.readiness = await getReadiness(args.baseUrl, account)
    report.blockers = readinessBlockers(report.readiness)
  } finally {
    await deleteTemporaryAccount(args.baseUrl, account)
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          productionReady: Boolean(report.readiness?.productionReady),
          launchBlockingCount: report.blockers.length,
        },
        null,
        2,
      ),
    )
  } else {
    const summary = report.readiness?.summary || {}
    line('INFO', 'base URL', report.baseUrl)
    line('READY', '/health', `model=${report.health.model}, storage=${report.health.storage}`)
    line(report.warnings.length ? 'WARNING' : 'READY', 'deployment commit', report.health.commitSha || 'unknown')
    for (const warning of report.warnings) line('WARNING', 'deployment check', warning)

    const counts = [
      `ready=${summary.ready ?? 0}`,
      `missing=${summary.missing ?? 0}`,
      `warning=${summary.warning ?? 0}`,
      `manual=${summary.manual ?? 0}`,
      `launchBlocking=${summary.launchBlocking ?? report.blockers.length}`,
    ].join(', ')
    line(report.readiness.productionReady ? 'READY' : 'BLOCKED', 'public launch readiness', counts)

    if (report.blockers.length > 0) {
      console.log('')
      console.log('Launch blockers:')
      for (const blocker of report.blockers) {
        const label = `${blocker.category}:${blocker.id}`
        line(blocker.status.toUpperCase(), label, blocker.action || blocker.detail || '')
      }
    }

    console.log('')
    if (report.readiness.productionReady && report.warnings.length === 0) {
      console.log('No launch blockers detected.')
    } else {
      console.log('Next command after resolving blockers:')
      console.log(`npm run audit:production -- --base-url ${report.baseUrl} --expected-commit ${report.health.commitSha} --strict-launch`)
    }
  }

  if (report.blockers.length > 0 || report.warnings.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`FAIL     launch status - ${error.message}`)
  process.exitCode = 1
})
