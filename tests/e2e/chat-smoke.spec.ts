import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const API_BASE_URL = (process.env.NOCLICK_E2E_API_BASE_URL || process.env.NOCLICK_E2E_BASE_URL || 'http://127.0.0.1:58788').replace(
  /\/+$/,
  '',
)

async function deleteAccount(request: APIRequestContext, email: string, token: string) {
  await request.post(`${API_BASE_URL}/v1/auth/delete-account`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { confirmEmail: email },
  })
}

test('chat-first automation flow creates an approval-gated run', async ({ page, request }) => {
  const suffix = Date.now().toString(36)
  const configuredEmail = process.env.NOCLICK_E2E_EMAIL || process.env.NOCLICK_AUDIT_EMAIL || ''
  const configuredPassword = process.env.NOCLICK_E2E_PASSWORD || process.env.NOCLICK_AUDIT_PASSWORD || ''
  const useConfiguredAccount = Boolean(configuredEmail && configuredPassword)
  const email = useConfiguredAccount ? configuredEmail : `noclick-e2e-${suffix}@example.com`
  const password = useConfiguredAccount ? configuredPassword : `E2ePass!${suffix}`
  let token = ''

  page.on('console', (message) => {
    if (message.text().includes('Failed to load resource')) return
    if (['error', 'warning'].includes(message.type())) {
      throw new Error(`Browser console ${message.type()}: ${message.text()}`)
    }
  })

  try {
    await page.addInitScript((apiBaseUrl) => {
      window.localStorage.setItem('noclickai.endpoint', apiBaseUrl)
    }, API_BASE_URL)
    await page.goto('/')
    await expect(page).toHaveTitle(/NoClick AI/)
    await expect(page.getByTestId('chat-panel')).toBeVisible()

    await page.getByTestId('account-email-input').fill(email)
    await page.getByTestId('account-password-input').fill(password)
    await page.getByTestId(useConfiguredAccount ? 'account-login' : 'account-register').click()
    await expect(page.getByTestId('account-email')).toHaveText(email)

    const session = await page.evaluate(() => window.localStorage.getItem('noclickai.authSession'))
    token = session ? JSON.parse(session).token : ''
    expect(token).toBeTruthy()

    const prompt = `Send an email to ${email} subject: E2E smoke body: Confirm the approval gate without external delivery.`
    await page.getByTestId('chat-input').fill(prompt)
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    await page.getByTestId('chat-send').click()

    await expect(page.getByTestId('run-step').first()).toBeVisible()
    await expect(page.getByTestId('run-approve')).toBeEnabled()
    await page.getByTestId('run-approve').click()
    await expect(page.getByTestId('run-execute')).toBeEnabled()
  } finally {
    if (token && !useConfiguredAccount) await deleteAccount(request, email, token).catch(() => undefined)
  }
})
