#!/usr/bin/env node

import crypto from 'node:crypto'

const DEFAULT_BASE_URL = 'https://noclickai-zeta.vercel.app'

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.NOCLICK_AUDIT_BASE_URL || DEFAULT_BASE_URL,
    email: process.env.NOCLICK_AUDIT_EMAIL || '',
    password: process.env.NOCLICK_AUDIT_PASSWORD || '',
    token: process.env.NOCLICK_AUDIT_TOKEN || '',
    strictLaunch: parseBoolean(process.env.NOCLICK_AUDIT_STRICT_LAUNCH),
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
    if (arg === '--strict-launch') {
      args.strictLaunch = true
      continue
    }
    if (arg === '--no-strict-launch') {
      args.strictLaunch = false
      continue
    }
    if (arg.startsWith('--strict-launch=')) {
      args.strictLaunch = parseBoolean(arg.slice('--strict-launch='.length))
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

async function expectSubscriptionRequired(baseUrl, account, path, options = {}) {
  const response = await fetchJson(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.token}`,
      ...(options.headers || {}),
    },
  })

  assert(response.response.status === 402, `${path} returned HTTP ${response.response.status}; expected 402`)
  assert(response.body?.error === 'subscription_required', `${path} returned ${response.body?.error}; expected subscription_required`)
}

async function checkSubscriptionGate(baseUrl, health, auditAccount) {
  if (!health.requireSubscription) {
    resultLine('PASS', 'subscription access mode', 'subscription enforcement is disabled')
    return
  }

  const status = await fetchJson(`${baseUrl}/v1/billing/status`, {
    headers: { Authorization: `Bearer ${auditAccount.token}` },
  })
  const privilegedAuditAccount = Boolean(
    status.response.ok &&
      (status.body?.user?.isAdmin ||
        status.body?.user?.billingPlan === 'admin' ||
        ['active', 'trialing'].includes(status.body?.user?.subscriptionStatus)),
  )
  assert(privilegedAuditAccount, 'subscription enforcement is enabled; use NOCLICK_AUDIT_EMAIL/PASSWORD or NOCLICK_AUDIT_TOKEN for an admin/pro account')

  const freeAccount = { ...(await createAuditAccount(baseUrl)), temporary: true }
  try {
    await expectSubscriptionRequired(baseUrl, freeAccount, '/v1/readiness')
    await expectSubscriptionRequired(baseUrl, freeAccount, '/v1/connectors')
    await expectSubscriptionRequired(baseUrl, freeAccount, '/v1/runs')
    await expectSubscriptionRequired(baseUrl, freeAccount, '/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Prepare a billing gate audit draft.' }),
    })
    resultLine('PASS', 'subscription access gate', 'free account blocked from paid automation APIs')
  } finally {
    await deleteAuditAccount(baseUrl, freeAccount)
  }
}

function summarizeReadiness(readiness) {
  const summary = readiness.summary || {}
  const counts = [
    `ready=${summary.ready ?? 0}`,
    `missing=${summary.missing ?? 0}`,
    `warning=${summary.warning ?? 0}`,
    `manual=${summary.manual ?? 0}`,
    `launchBlocking=${summary.launchBlocking ?? 'unknown'}`,
  ].join(', ')
  resultLine(readiness.productionReady ? 'PASS' : 'WARN', 'readiness summary', counts)

  const blockers = (readiness.items || []).filter((item) => item.status !== 'ready')
  for (const item of blockers) {
    resultLine(item.status.toUpperCase(), `${item.category}:${item.id}`, item.action || item.detail)
  }
}

function launchBlockingItems(readiness) {
  const items = readiness.items || []
  const hasLaunchBlockingField = items.some((item) => typeof item.launchBlocking === 'boolean')
  return items.filter((item) => (hasLaunchBlockingField ? item.launchBlocking : item.status !== 'ready'))
}

function assertStrictLaunchReady(readiness) {
  if (readiness.productionReady) {
    resultLine('PASS', 'strict launch readiness', 'productionReady=true')
    return
  }

  const blockers = launchBlockingItems(readiness)
  const blockerSummary = blockers
    .slice(0, 8)
    .map((item) => `${item.category}:${item.id}=${item.status}`)
    .join('; ')
  const remaining = blockers.length > 8 ? `; +${blockers.length - 8} more` : ''
  throw new Error(`strict launch readiness failed: ${blockers.length} blocker(s) remain: ${blockerSummary}${remaining}`)
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

  const requiredReadyIds = [
    'PRIVACY_POLICY_URL',
    'TERMS_URL',
    'DATA_DELETION_URL',
    'DOWNLOADS_URL',
    'GITHUB_RELEASE',
    'release:android-apk',
    'release:android-aab',
    'release:windows-installer',
    'release:sha256sums',
    'notion:configured',
    'slack:configured',
    'telegram:configured',
    'kakao:configured',
  ]
  for (const id of requiredReadyIds) {
    const item = body.items?.find((entry) => entry.id === id)
    assert(item, `/v1/readiness is missing ${id}`)
    assert(item.status === 'ready', `${id} readiness status is ${item.status}`)
  }

  resultLine('PASS', '/v1/readiness', 'public review pages and release assets are ready')
  summarizeReadiness(body)
  return body
}

async function checkBillingFlow(baseUrl, account) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const status = await fetchJson(`${baseUrl}/v1/billing/status`, { headers })

  assert(status.response.ok, `/v1/billing/status returned HTTP ${status.response.status}`)
  assert(status.body?.ok, '/v1/billing/status did not return ok=true')
  assert(status.body?.user?.email, '/v1/billing/status did not return a user')
  assert(typeof status.body.stripeConfigured === 'boolean', '/v1/billing/status did not include stripeConfigured')
  assert(typeof status.body.checkoutReady === 'boolean', '/v1/billing/status did not include checkoutReady')
  assert(typeof status.body.portalReady === 'boolean', '/v1/billing/status did not include portalReady')

  const isAdmin = Boolean(status.body.user.isAdmin || status.body.user.billingPlan === 'admin')
  const checkout = await fetchJson(`${baseUrl}/v1/billing/checkout`, {
    method: 'POST',
    headers,
  })

  if (isAdmin) {
    assert(checkout.response.ok && checkout.body?.admin === true, 'admin checkout should be bypassed without Stripe')
  } else if (status.body.stripeConfigured) {
    assert(checkout.response.ok, `/v1/billing/checkout returned HTTP ${checkout.response.status}`)
    assert(checkout.body?.url, '/v1/billing/checkout did not return a checkout URL')
  } else {
    assert(checkout.response.status === 400, `/v1/billing/checkout without Stripe returned HTTP ${checkout.response.status}`)
    assert(checkout.body?.error === 'stripe_not_configured', `/v1/billing/checkout returned ${checkout.body?.error}`)
  }

  const portal = await fetchJson(`${baseUrl}/v1/billing/portal`, {
    method: 'POST',
    headers,
  })

  if (isAdmin) {
    assert(portal.response.status === 400, `/v1/billing/portal for admin returned HTTP ${portal.response.status}`)
    assert(portal.body?.error === 'admin_billing_not_required', `/v1/billing/portal for admin returned ${portal.body?.error}`)
  } else if (portal.response.ok) {
    assert(portal.body?.url, '/v1/billing/portal did not return a portal URL')
  } else {
    const expectedError = status.body.stripeConfigured ? 'stripe_customer_missing' : 'stripe_not_configured'
    assert(portal.response.status === 400, `/v1/billing/portal returned HTTP ${portal.response.status}`)
    assert(portal.body?.error === expectedError, `/v1/billing/portal returned ${portal.body?.error}`)
  }

  resultLine('PASS', 'billing API flow', isAdmin ? 'admin bypass verified' : `stripeConfigured=${status.body.stripeConfigured}`)
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

async function checkPreparedAutomation(baseUrl, account, provider, expectedAction, expectedCode, promptPrefix) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const verificationText = `NoClick AI audit ${crypto.randomUUID().slice(0, 8)}`
  const prompt = `${promptPrefix} containing "${verificationText}". Do not send it; only prepare copyable text.`

  const created = await fetchJson(`${baseUrl}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: prompt }),
  })
  assert(created.response.status === 201, `/v1/chat ${provider} request returned HTTP ${created.response.status}`)
  assert(created.body?.run?.id, `/v1/chat ${provider} request did not return a run id`)

  const plannedStep = created.body.run.steps?.find((step) => step.provider === provider)
  assert(plannedStep, `${provider} prompt did not produce a ${provider} step`)
  assert(plannedStep.action === expectedAction, `${provider} step used unexpected action ${plannedStep.action}`)
  assert(plannedStep.status === 'ready', `${provider} step should be ready, got ${plannedStep.status}`)

  const executed = await fetchJson(`${baseUrl}/v1/runs/${created.body.run.id}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmHighRisk: true }),
  })
  assert(executed.response.ok, `/v1/runs/:id/execute ${provider} request returned HTTP ${executed.response.status}`)
  assert(executed.body?.run?.status === 'done', `${provider} audit run status is ${executed.body?.run?.status}`)

  const executedStep = executed.body.run.steps?.find((step) => step.provider === provider)
  assert(executedStep?.status === 'done', `${provider} executed step status is ${executedStep?.status}`)
  assert(executedStep.result?.ok === true, `${provider} prepared fallback did not return ok=true`)
  assert(executedStep.result?.code === expectedCode, `${provider} prepared fallback returned ${executedStep.result?.code}`)
  assert(String(executedStep.result?.shareText || '').includes(verificationText), `${provider} prepared text is missing the verification text`)

  resultLine('PASS', `${provider} chat automation`, `run=${created.body.run.id}`)
}

async function checkTelegramShareAutomation(baseUrl, account) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const verificationText = `NoClick AI audit ${crypto.randomUUID().slice(0, 8)}`
  const prompt = `Prepare a Telegram share text for the team containing "${verificationText}". Do not send it; only prepare share text.`

  const created = await fetchJson(`${baseUrl}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: prompt }),
  })
  assert(created.response.status === 201, `/v1/chat Telegram request returned HTTP ${created.response.status}`)
  assert(created.body?.run?.id, '/v1/chat Telegram request did not return a run id')

  const plannedStep = created.body.run.steps?.find((step) => step.provider === 'telegram')
  assert(plannedStep, 'Telegram prompt did not produce a Telegram step')
  assert(plannedStep.action === 'telegram.prepare_message', `Telegram step used unexpected action ${plannedStep.action}`)
  assert(plannedStep.status === 'ready', `Telegram step should be ready, got ${plannedStep.status}`)

  const executed = await fetchJson(`${baseUrl}/v1/runs/${created.body.run.id}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmHighRisk: true }),
  })
  assert(executed.response.ok, `/v1/runs/:id/execute Telegram request returned HTTP ${executed.response.status}`)
  assert(executed.body?.run?.status === 'done', `Telegram audit run status is ${executed.body?.run?.status}`)

  const executedStep = executed.body.run.steps?.find((step) => step.provider === 'telegram')
  assert(executedStep?.status === 'done', `Telegram executed step status is ${executedStep?.status}`)
  assert(executedStep.result?.ok === true, 'Telegram share fallback did not return ok=true')
  assert(executedStep.result?.code === 'share_prepared', `Telegram share fallback returned ${executedStep.result?.code}`)
  assert(String(executedStep.result?.shareText || '').includes(verificationText), 'Telegram share text is missing the verification text')

  resultLine('PASS', 'Telegram chat automation', `run=${created.body.run.id}`)
}

async function checkHighRiskApprovalGate(baseUrl, account) {
  const headers = { Authorization: `Bearer ${account.token}` }
  const suffix = crypto.randomUUID().slice(0, 8)
  const recipient = `audit-${suffix}@example.com`
  const prompt = `Send an email to ${recipient} with subject "NoClick approval audit" and body "This should require approval."`

  const created = await fetchJson(`${baseUrl}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: prompt }),
  })
  assert(created.response.status === 201, `/v1/chat high-risk request returned HTTP ${created.response.status}`)
  assert(created.body?.run?.status === 'needs_approval', `High-risk run status is ${created.body?.run?.status}`)

  const step = created.body.run.steps?.find((entry) => entry.provider === 'gmail')
  assert(step, 'High-risk email request did not produce a Gmail step')
  assert(step.action === 'gmail.send_message', `High-risk Gmail step used ${step.action}`)
  assert(step.risk === 'high', `High-risk Gmail step risk is ${step.risk}`)
  assert(step.status === 'needs_approval', `High-risk Gmail step status is ${step.status}`)
  assert(step.input?.to === recipient, `High-risk Gmail recipient is ${step.input?.to}`)

  const prematureExecute = await fetchJson(`${baseUrl}/v1/runs/${created.body.run.id}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmHighRisk: true }),
  })
  assert(prematureExecute.response.ok, `/v1/runs/:id/execute high-risk gate returned HTTP ${prematureExecute.response.status}`)
  const guardedStep = prematureExecute.body?.run?.steps?.find((entry) => entry.id === step.id)
  assert(prematureExecute.body?.run?.status === 'needs_approval', `Premature high-risk execute changed run status to ${prematureExecute.body?.run?.status}`)
  assert(guardedStep?.status === 'needs_approval', `Premature high-risk execute changed step status to ${guardedStep?.status}`)
  assert(!guardedStep?.result, 'Premature high-risk execute produced a result before approval')

  resultLine('PASS', 'high-risk approval gate', `run=${created.body.run.id}`)
}

async function main() {
  const { baseUrl, email, password, token, strictLaunch } = parseArgs(process.argv)
  let account = null

  console.log(`NoClick AI production audit: ${baseUrl}`)
  if (strictLaunch) {
    resultLine('INFO', 'strict launch mode', 'enabled')
  }

  try {
    const health = await fetchJson(`${baseUrl}/health`)
    assert(health.response.ok && health.body?.ok, `/health returned HTTP ${health.response.status}`)
    assert(health.body.auth && health.body.chat && health.body.connectors && health.body.billing, '/health is missing expected service flags')
    resultLine('PASS', '/health', `model=${health.body.model}, storage=${health.body.storage}`)

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
    const readiness = await checkReadiness(baseUrl, account)
    await checkBillingFlow(baseUrl, account)
    await checkSubscriptionGate(baseUrl, health.body, account)
    await checkPreparedAutomation(baseUrl, account, 'notion', 'notion.prepare_page', 'content_prepared', 'Prepare a Notion page draft')
    await checkPreparedAutomation(baseUrl, account, 'slack', 'slack.prepare_message', 'share_prepared', 'Prepare a Slack message')
    await checkTelegramShareAutomation(baseUrl, account)
    await checkKakaoShareAutomation(baseUrl, account)
    await checkHighRiskApprovalGate(baseUrl, account)
    if (strictLaunch) {
      assertStrictLaunchReady(readiness)
    }
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
