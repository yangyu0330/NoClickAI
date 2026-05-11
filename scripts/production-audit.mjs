#!/usr/bin/env node

import crypto from 'node:crypto'

const DEFAULT_BASE_URL = 'https://noclickai-zeta.vercel.app'

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.NOCLICK_AUDIT_BASE_URL || DEFAULT_BASE_URL,
    email: process.env.NOCLICK_AUDIT_EMAIL || '',
    password: process.env.NOCLICK_AUDIT_PASSWORD || '',
    token: process.env.NOCLICK_AUDIT_TOKEN || '',
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
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, '')
  return args
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function resultLine(status, label, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`${status.padEnd(7)} ${label}${suffix}`)
}

async function checkPublicPage(baseUrl, path, requiredText) {
  const { response, text } = await fetchText(`${baseUrl}${path}`)
  const missing = requiredText.filter((item) => !text.includes(item))
  assert(response.ok, `${path} returned HTTP ${response.status}`)
  assert(missing.length === 0, `${path} is missing required text: ${missing.join(', ')}`)
  resultLine('PASS', path, `HTTP ${response.status}`)
}

async function createAuditAccount(baseUrl) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const email = `noclick-audit-${suffix}@example.com`
  const password = `AuditPass!${suffix}`
  const { response, body } = await fetchJson(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      name: 'NoClick Audit',
    }),
  })

  assert(response.status === 201, `/v1/auth/register returned HTTP ${response.status}`)
  assert(body?.token, '/v1/auth/register did not return a session token')
  resultLine('PASS', 'temporary account registered', email)
  return { email, token: body.token }
}

async function loginAuditAccount(baseUrl, email, password) {
  const { response, body } = await fetchJson(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  assert(response.ok, `/v1/auth/login returned HTTP ${response.status}`)
  assert(body?.token, '/v1/auth/login did not return a session token')
  resultLine('PASS', 'audit account login', email)
  return { email, token: body.token, temporary: false }
}

async function deleteAuditAccount(baseUrl, account) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const { response, body } = await fetchJson(`${baseUrl}/v1/auth/delete-account`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmEmail: account.email }),
  })

  assert(response.ok && body?.ok, `/v1/auth/delete-account returned HTTP ${response.status}`)

  const me = await fetchJson(`${baseUrl}/v1/auth/me`, { headers })
  assert(me.response.status === 401, '/v1/auth/me should return 401 after account deletion')
  resultLine('PASS', 'temporary account deleted', 'post-delete /me returned 401')
}

function summarizeReadiness(readiness) {
  const summary = readiness.summary || {}
  const counts = [
    `ready=${summary.ready ?? 0}`,
    `missing=${summary.missing ?? 0}`,
    `warning=${summary.warning ?? 0}`,
    `manual=${summary.manual ?? 0}`,
  ].join(', ')
  resultLine(readiness.productionReady ? 'PASS' : 'WARN', 'readiness summary', counts)

  const blockers = (readiness.items || []).filter((item) => item.status !== 'ready')
  for (const item of blockers) {
    resultLine(item.status.toUpperCase(), `${item.category}:${item.id}`, item.action || item.detail)
  }
}

async function checkReadiness(baseUrl, account) {
  const { response, body } = await fetchJson(`${baseUrl}/v1/readiness`, {
    headers: { Authorization: `Bearer ${account.token}` },
  })
  if (response.status === 402) {
    throw new Error('/v1/readiness requires a paid, pro, or admin account. Set NOCLICK_AUDIT_EMAIL and NOCLICK_AUDIT_PASSWORD to an admin/pro account for paid-launch audits.')
  }
  assert(response.ok, `/v1/readiness returned HTTP ${response.status}`)
  assert(body?.ok, '/v1/readiness did not return ok=true')

  const requiredReadyIds = ['PRIVACY_POLICY_URL', 'TERMS_URL', 'DATA_DELETION_URL', 'kakao:configured']
  for (const id of requiredReadyIds) {
    const item = body.items?.find((entry) => entry.id === id)
    assert(item, `/v1/readiness is missing ${id}`)
    assert(item.status === 'ready', `${id} readiness status is ${item.status}`)
  }

  resultLine('PASS', '/v1/readiness', 'public review pages are ready')
  summarizeReadiness(body)
}

async function checkKakaoShareAutomation(baseUrl, account) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const verificationText = `NoClick AI audit ${crypto.randomUUID().slice(0, 8)}`
  const prompt = `Prepare a KakaoTalk share text for the team containing "${verificationText}". Do not send it; only prepare share text.`

  const created = await fetchJson(`${baseUrl}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: prompt }),
  })
  assert(created.response.status === 201, `/v1/chat returned HTTP ${created.response.status}`)
  assert(created.body?.run?.id, '/v1/chat did not return a run id')
  assert(created.body?.assistantMessage, '/v1/chat did not return an assistant message')

  const plannedStep = created.body.run.steps?.find((step) => step.provider === 'kakao')
  assert(plannedStep, 'Kakao prompt did not produce a Kakao step')
  assert(plannedStep.action === 'kakao.share_text', `Kakao step used unexpected action ${plannedStep.action}`)
  assert(plannedStep.status === 'ready', `Kakao step should be ready, got ${plannedStep.status}`)

  const executed = await fetchJson(`${baseUrl}/v1/runs/${created.body.run.id}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmHighRisk: true }),
  })
  assert(executed.response.ok, `/v1/runs/:id/execute returned HTTP ${executed.response.status}`)
  assert(executed.body?.run?.status === 'done', `Kakao audit run status is ${executed.body?.run?.status}`)

  const executedStep = executed.body.run.steps?.find((step) => step.provider === 'kakao')
  assert(executedStep?.status === 'done', `Kakao executed step status is ${executedStep?.status}`)
  assert(executedStep.result?.ok === true, 'Kakao share fallback did not return ok=true')
  assert(executedStep.result?.code === 'share_prepared', `Kakao share fallback returned ${executedStep.result?.code}`)
  assert(String(executedStep.result?.shareText || '').includes(verificationText), 'Kakao share text is missing the verification text')

  resultLine('PASS', 'Kakao chat automation', `run=${created.body.run.id}`)
}

async function main() {
  const { baseUrl, email, password, token } = parseArgs(process.argv)
  let account = null

  console.log(`NoClick AI production audit: ${baseUrl}`)

  try {
    const { response, body } = await fetchJson(`${baseUrl}/health`)
    assert(response.ok && body?.ok, `/health returned HTTP ${response.status}`)
    assert(body.auth && body.chat && body.connectors && body.billing, '/health is missing expected service flags')
    resultLine('PASS', '/health', `model=${body.model}, storage=${body.storage}`)

    await checkPublicPage(baseUrl, '/privacy', ['Privacy Policy', 'Google User Data', 'Limited Use', '/data-deletion'])
    await checkPublicPage(baseUrl, '/terms', ['Terms of Service', 'High-Risk Actions'])
    await checkPublicPage(baseUrl, '/downloads', ['Downloads', 'Android', 'Windows'])
    await checkPublicPage(baseUrl, '/data-deletion', ['Data Deletion', 'Delete Your Account', 'Disconnect Google'])

    if (token) {
      account = { email: 'token-authenticated account', token, temporary: false }
      resultLine('PASS', 'audit token configured')
    } else if (email && password) {
      account = await loginAuditAccount(baseUrl, email, password)
    } else {
      account = { ...(await createAuditAccount(baseUrl)), temporary: true }
    }
    await checkReadiness(baseUrl, account)
    await checkKakaoShareAutomation(baseUrl, account)
  } finally {
    if (account?.temporary) {
      await deleteAuditAccount(baseUrl, account)
    }
  }
}

main().catch((error) => {
  resultLine('FAIL', 'production audit', error.message)
  process.exitCode = 1
})
