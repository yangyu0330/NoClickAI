# NoClick AI

NoClick AI is a chat-first automation assistant. The intended user experience is simple: the user types what they want done, the app creates an execution plan, asks for approval when an action is risky, and then runs connected tools such as Google Calendar, Gmail, Notion, Slack, Telegram, or KakaoTalk when those provider credentials are configured.

The project shares one React app across:

- Web/PWA on Vercel
- Android through Capacitor
- Windows desktop through Electron

Production URL:

```text
https://noclickai-zeta.vercel.app
```

Internal release:

```text
https://github.com/yangyu0330/NoClickAI/releases/tag/v0.1.0-internal.1
```

## Current Status

Implemented:

- Account registration, login, logout, and account deletion
- Admin allowlist for payment-free internal use
- OpenAI-backed chat planning with `gpt-5-nano` by default
- Runs, approval gates, execution logs, and workspace sync
- Google OAuth connection for Calendar and Gmail
- Gmail send support with explicit high-risk approval
- In-app Gmail review drafts without requesting the restricted `gmail.compose` scope by default
- Stripe billing endpoints and webhook handling
- Neon Postgres storage in production
- Public review pages for privacy, terms, downloads, and data deletion
- Android release APK/AAB build outputs
- Windows installer build output
- Production readiness API at `GET /v1/readiness`

Still required before public commercial launch:

- Google OAuth public verification
- Stripe live secret, recurring Price ID, and webhook secret
- Production credentials for Notion, Slack, Telegram, and KakaoTalk
- Publicly trusted Windows code-signing certificate
- Store review/distribution for Android and Windows

## Quick Start

Install dependencies:

```bash
npm install
```

Run the web app and sync server locally:

```bash
npm run dev:full
```

Local URLs:

```text
Web/PWA: http://localhost:5173
Sync API: http://127.0.0.1:8788
```

Validate before committing:

```bash
npm run lint
npm run build
```

The GitHub Actions CI workflow runs `npm ci`, server syntax checks, audit-script syntax checks, lint, and build on pushes to `main` and pull requests.

Audit the production deployment:

```bash
npm run audit:production
```

The audit checks `/health`, the public review pages, the downloads page, authenticated readiness, and account deletion cleanup using a temporary account.

When subscription enforcement is enabled, run the audit with an admin or paid account instead of a temporary free account:

```bash
NOCLICK_AUDIT_EMAIL=admin@example.com NOCLICK_AUDIT_PASSWORD=... npm run audit:production
```

PowerShell:

```powershell
$env:NOCLICK_AUDIT_EMAIL='admin@example.com'
$env:NOCLICK_AUDIT_PASSWORD='...'
npm run audit:production
```

## Environment

Copy `.env.example` to `.env` for local development and fill in the values that match your environment.

Important variables:

```env
NOCLICK_SYNC_TOKEN=replace-with-a-long-random-token
NOCLICK_PUBLIC_APP_URL=https://noclickai-zeta.vercel.app
NOCLICK_SERVER_BASE_URL=https://noclickai-zeta.vercel.app
NOCLICK_ALLOWED_ORIGIN=https://noclickai-zeta.vercel.app
VITE_NOCLICK_SERVER_BASE_URL=https://noclickai-zeta.vercel.app
NOCLICK_RELEASE_TAG=v0.1.0-internal.1
NOCLICK_ADMIN_EMAILS=admin@example.com
NOCLICK_TOKEN_ENCRYPTION_KEY=replace-with-long-token-encryption-secret
OPENAI_API_KEY=sk-...
NOCLICK_OPENAI_MODEL=gpt-5-nano
```

Provider and billing variables are documented in `docs/deployment.md`.

## API Surface

Health and readiness:

- `GET /health`
- `GET /v1/readiness`

Accounts:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/delete-account`
- `GET /v1/auth/me`

Chat automation:

- `POST /v1/chat`
- `GET /v1/runs`
- `POST /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/approve`
- `POST /v1/runs/:runId/execute`
- `POST /v1/plan`

Connectors:

- `GET /v1/connectors`
- `GET /v1/connectors/:provider/start`
- `GET /v1/connectors/:provider/callback`
- `POST /v1/connectors/:provider/disconnect`

Billing:

- `GET /v1/billing/status`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/billing/webhook`

## Public Review Pages

These pages are served without authentication and are used for OAuth/app review:

- `/privacy`
- `/terms`
- `/downloads`
- `/data-deletion`

`GET /v1/readiness` verifies that the public review pages are reachable and contain required review text. It also checks the downloads page, GitHub release, and expected release assets for the configured release tag.

## Google OAuth

Google Calendar and Gmail share one Google OAuth connection.

Default public OAuth scopes:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`

`gmail.compose` is disabled by default because it is a restricted Gmail scope. Set `NOCLICK_ENABLE_GMAIL_DRAFTS=true` only if restricted-scope verification and any required security assessment are planned.

Setup details are in `docs/google-oauth.md`.

## Android

Sync Capacitor after building the web app:

```bash
npm run android:sync
npm run android:open
```

Release signing uses `android/keystore.properties`, which is ignored by Git. See `docs/deployment.md` for signing setup.

Known internal release assets:

- `NoClickAI-Android-v0.1.0-internal.1.apk`
- `NoClickAI-Android-v0.1.0-internal.1.aab`

## Windows Desktop

Run locally:

```bash
npm run desktop:dev
```

Build an installer:

```bash
npm run desktop:dist
```

Build with code signing variables:

```bash
npm run desktop:dist:signed
```

A public trusted certificate is required before broad Windows distribution.

Known internal release asset:

- `NoClickAI-Windows-Setup-v0.1.0-internal.1.exe`

## Deployment

The project is linked to Vercel. Production deploy:

```bash
npx vercel@latest --prod --yes --force
```

Inspect a deployment:

```bash
npx vercel@latest inspect https://noclickai-zeta.vercel.app
```

Production readiness:

```bash
curl https://noclickai-zeta.vercel.app/health
```

After signing in, call:

```bash
curl -H "Authorization: Bearer <session-token>" https://noclickai-zeta.vercel.app/v1/readiness
```

Or run the bundled production audit:

```bash
npm run audit:production
```

Optional audit environment variables:

- `NOCLICK_AUDIT_BASE_URL`: target deployment URL
- `NOCLICK_AUDIT_EMAIL` and `NOCLICK_AUDIT_PASSWORD`: existing admin/pro account for paid-launch audits
- `NOCLICK_AUDIT_TOKEN`: existing session token when password login should not be used

The same audit can be run from GitHub Actions through the manual `CI` workflow by enabling `run_production_audit`. Store audit credentials as repository secrets named `NOCLICK_AUDIT_EMAIL`, `NOCLICK_AUDIT_PASSWORD`, or `NOCLICK_AUDIT_TOKEN`.

## Documentation

- `docs/deployment.md`: production secrets, HTTPS, billing, release signing, and release checks
- `docs/google-oauth.md`: Google Cloud OAuth setup and Gmail/Calendar testing
