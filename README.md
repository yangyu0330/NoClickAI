# NoClick AI

NoClick AI is a chat-first automation assistant. The intended user experience is simple: the user types what they want done, the app creates an execution plan, asks for approval when an action is risky, and then runs connected tools such as Google Calendar, Gmail, Notion, Slack, and Telegram when provider credentials are configured. Notion, Slack, Telegram, and KakaoTalk also use browser/Android share fallbacks for prepared content.

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
- Notion prepared-page fallback without server credentials
- Slack prepared-message fallback without server credentials
- Telegram prepared-share fallback without server credentials
- KakaoTalk prepared-share fallback without server credentials
- Stripe billing endpoints and webhook handling
- Neon Postgres storage in production
- Public review pages for privacy, terms, downloads, and data deletion
- Android release APK/AAB build outputs
- Windows installer build output
- Production readiness API at `GET /v1/readiness`

Still required before public commercial launch:

- Google OAuth public verification
- Stripe live secret, recurring Price ID, and webhook secret
- Optional Notion OAuth credentials if direct Notion page creation is required beyond the prepared-page fallback
- Optional Slack OAuth credentials if direct Slack posting is required beyond the prepared-message fallback
- Optional Telegram Bot API credentials if direct Telegram bot delivery is required beyond the share fallback
- Optional Kakao direct Message API credentials if direct Kakao API delivery is required beyond the share fallback
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
npm run test:launch-evidence
npm run test:launch-env
npm run test:launch-stripe
npm run test:billing
npm run test:readiness
npm run test:e2e
```

The GitHub Actions CI workflow runs `npm ci`, server syntax checks, audit-script syntax checks, high-severity dependency audit, lint, build, local launch-evidence smoke, local launch-env smoke, local Stripe launch smoke, local billing webhook smoke, local readiness smoke, and a Playwright smoke test on pushes to `main` and pull requests.

The local billing smoke starts an isolated sync server with subscription enforcement enabled, rejects an unsigned Stripe webhook, applies signed checkout, past-due, payment-recovery, and deletion events, and verifies paid routes open and close with the Stripe subscription state:

```bash
npm run test:billing
```

The readiness smoke starts isolated local sync servers and verifies launch-blocking readiness rules for manual evidence attestations, live Stripe key prefixes, and the exact Google OAuth redirect URI:

```bash
npm run test:readiness
```

Run the same browser smoke against the deployed app:

```bash
npm run test:e2e:production
```

For the final public launch check, use the GitHub Actions `Public Launch Gate` workflow. It runs the strict production readiness gate, production browser smoke, and signed Android/Windows package workflow in one release-oriented pass.

Audit the production deployment:

```bash
npm run audit:production
```

The audit checks `/health`, production security headers, the deployed commit reported by `/health`, the root app shell with JS/CSS/PWA assets, service-worker API-cache exclusions, the public review pages, the downloads page, static traversal guarding, GitHub release assets, authenticated readiness, billing API behavior, Stripe webhook signature guarding, subscription access gating when enabled, safe chat-to-Notion, chat-to-Slack, chat-to-Telegram, and chat-to-KakaoTalk prepared-content automation runs, high-risk Gmail approval gating without sending email, and account deletion cleanup using a temporary account.

For a shorter operator view of the current public-launch blockers, run:

```bash
npm run launch:status
```

`launch:status` checks `/health`, creates a temporary account when audit credentials are not supplied, reads `/v1/readiness`, deletes the temporary account, and prints the exact launch-blocking items that still need provider-console or signing work. It exits nonzero while any launch blocker remains.

After the external launch work is complete, copy `.env.launch.example` to `.env.launch.local`, fill in the live Stripe values and non-secret Google/Android/Windows evidence markers, then validate without changing Vercel:

```bash
npm run launch:env -- --file .env.launch.local
```

If you have signed app package evidence files, generate the non-secret evidence variables from them:

```bash
npm run launch:evidence -- --android artifacts/android/ANDROID-SIGNING-EVIDENCE.txt --android-play-console play-console-production-YYYY-MM-DD --windows artifacts/windows/WINDOWS-SIGNING-EVIDENCE.txt --google-evidence google-oauth-approved-YYYY-MM-DD --output .env.launch.local
```

After adding `STRIPE_SECRET_KEY=sk_live_...` to `.env.launch.local`, create the recurring Stripe Price and billing webhook endpoint:

```bash
npm run launch:stripe -- --file .env.launch.local --amount 9900 --currency usd --interval month --base-url https://noclickai-zeta.vercel.app --apply
```

To apply those values to Vercel Production, redeploy, and run the strict launch gate:

```bash
npm run launch:env -- --file .env.launch.local --apply --deploy --verify --strict
```

The launch-env smoke test verifies that placeholder/test values are rejected and valid-looking launch values stay in dry-run mode unless `--apply` is explicitly present:

```bash
npm run test:launch-evidence
npm run test:launch-env
npm run test:launch-stripe
```

Run the same audit concurrently to catch account/session persistence regressions under overlapping production requests:

```bash
npm run audit:production:parallel -- --runs 2
```

When run from a git checkout, the audit warns if the deployed `commitSha` does not match the local `HEAD`. In CI, pass the exact commit to make deployment drift fail the audit:

```bash
npm run audit:production -- --expected-commit "$GITHUB_SHA"
```

For a final public-launch gate, enable strict launch mode. This still runs the same functional checks, then exits with a failure if `/v1/readiness` reports any launch-blocking item:

```bash
npm run audit:production -- --strict-launch
```

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

To verify that the supplied audit account is the configured admin account and bypasses checkout, require admin mode:

```bash
npm run audit:production -- --require-admin
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
NOCLICK_TOKEN_ENCRYPTION_KEY=replace-with-long-token-encryption-secret-that-is-not-the-sync-token
OPENAI_API_KEY=sk-...
NOCLICK_OPENAI_MODEL=gpt-5-nano
NOCLICK_GOOGLE_OAUTH_VERIFIED=false
NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE=
NOCLICK_ANDROID_RELEASE_SIGNED=false
NOCLICK_ANDROID_RELEASE_EVIDENCE=
NOCLICK_WINDOWS_CODE_SIGNED=false
NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE=
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

The repository also includes a manual GitHub Actions workflow named `Deploy Production`. Configure `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as repository secrets, then run the workflow to verify, run the billing webhook smoke, deploy to Vercel Production, inspect the deployment, run `npm run audit:production`, and check recent Production error logs. If the Vercel CLI token is missing or expired but the Vercel Git integration has already deployed the commit, the workflow can fall back to waiting for `/health.commitSha` to match the workflow commit.

The deployment workflow writes the current Git commit into `/health` and the production audit checks it with `NOCLICK_AUDIT_EXPECTED_COMMIT`, so a green deploy verifies the expected commit is what production is serving.

If `Deploy Production` reports an invalid Vercel token, create a new Vercel account token and update the GitHub secret so CLI deploys, Vercel inspect, and Vercel log scans work again:

```powershell
$env:VERCEL_TOKEN='new-vercel-token'
gh secret set VERCEL_TOKEN --repo yangyu0330/NoClickAI --body $env:VERCEL_TOKEN
```

If GitHub Actions cannot deploy because `VERCEL_TOKEN` is invalid and the deploy hook does not publish the current commit, deploy from a locally logged-in Vercel CLI session:

```bash
npx vercel@latest deploy --prod --yes --force -e NOCLICK_COMMIT_SHA="$(git rev-parse HEAD)" -b NOCLICK_COMMIT_SHA="$(git rev-parse HEAD)"
```

For app packages, use the manual `Build App Packages` workflow. It builds Android APK/AAB and the Windows installer, verifies signatures when `require_signing=true`, uploads workflow artifacts, and can attach them to a GitHub release when signing secrets are configured.

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
- `NOCLICK_AUDIT_REQUIRE_ADMIN`: set to `true` to fail unless the audit account has admin billing bypass
- `NOCLICK_PARALLEL_AUDIT_RUNS`: worker count for `npm run audit:production:parallel`

The same audit can be run from GitHub Actions through the manual `CI` workflow by enabling `run_production_audit`. Store audit credentials as repository secrets named `NOCLICK_AUDIT_EMAIL`, `NOCLICK_AUDIT_PASSWORD`, or `NOCLICK_AUDIT_TOKEN`. Use `parallel_audit_runs` to run overlapping production audits after the main audit.

## Documentation

- `docs/deployment.md`: production secrets, HTTPS, billing, release signing, and release checks
- `docs/production-readiness.md`: operating checklist, verification commands, risk policy, and remaining launch blockers
- `docs/google-oauth.md`: Google Cloud OAuth setup and Gmail/Calendar testing
