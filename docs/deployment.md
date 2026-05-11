# Deployment

NoClick AI now has production hooks for HTTPS, accounts, Stripe subscriptions, and signed app packages.

## Required Secrets

Create `.env` on the server. Do not commit it.

```env
NOCLICK_SYNC_TOKEN=replace-with-32-byte-random-token
NOCLICK_PUBLIC_APP_URL=https://app.your-domain.example
NOCLICK_SERVER_BASE_URL=https://api.your-domain.example
NOCLICK_ALLOWED_ORIGIN=https://app.your-domain.example
VITE_NOCLICK_SERVER_BASE_URL=https://api.your-domain.example
NOCLICK_RELEASE_TAG=v0.1.0-internal.1
NOCLICK_REQUIRE_SUBSCRIPTION=true
NOCLICK_TOKEN_ENCRYPTION_KEY=replace-with-long-token-encryption-secret
OPENAI_API_KEY=sk-...
NOCLICK_OPENAI_MODEL=gpt-5-nano

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.your-domain.example/v1/connectors/google/callback
# Optional: Notion prepared-page fallback works without these. Set them only for direct page creation.
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
NOTION_REDIRECT_URI=https://api.your-domain.example/v1/connectors/notion/callback
NOTION_PARENT_PAGE_ID=...
# Optional: Slack prepared-message fallback works without these. Set them only for direct posting.
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_REDIRECT_URI=https://api.your-domain.example/v1/connectors/slack/callback
SLACK_DEFAULT_CHANNEL_ID=...
# Optional: Telegram share fallback works without these. Set them only for direct bot delivery.
TELEGRAM_BOT_TOKEN=...
TELEGRAM_DEFAULT_CHAT_ID=...
# Optional: KakaoTalk share fallback works without these. Set them only for direct Kakao API experiments.
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...
KAKAO_REDIRECT_URI=https://api.your-domain.example/v1/connectors/kakao/callback

STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://app.your-domain.example?billing=success
STRIPE_CANCEL_URL=https://app.your-domain.example?billing=cancel
STRIPE_PORTAL_RETURN_URL=https://app.your-domain.example
```

## HTTPS Server

Use a managed HTTPS platform in production whenever possible. If you run the Node server directly, provide a TLS certificate:

```env
NOCLICK_TLS_KEY_PATH=C:/secure/noclickai.key
NOCLICK_TLS_CERT_PATH=C:/secure/noclickai.crt
HOST=0.0.0.0
PORT=8788
```

Then run:

```bash
npm run sync:server
```

`GET /health` returns the active protocol, AI model, account support, billing support, and whether Stripe is configured.

After signing in, `GET /v1/readiness` returns a production readiness checklist without exposing secret values. The web app shows the same checklist in the deployment readiness panel so missing provider credentials, billing settings, public OAuth verification, and app-signing manual gates are visible before launch.

For packaged Android and Windows builds, set `VITE_NOCLICK_SERVER_BASE_URL` before `npm run android:sync` or `npm run desktop:dist`. Browser deployments can use same-origin API routing, but packaged apps run from a local WebView or `file://` origin and need a production HTTPS API default.

The current internal test installers are published at:

```text
https://github.com/yangyu0330/NoClickAI/releases/tag/v0.1.0-internal.1
```

The public web app also exposes the same release links at `/downloads`.

`GET /v1/readiness` performs HEAD checks against `/downloads`, the GitHub release page, and the expected APK/AAB/Windows/checksum artifacts for `NOCLICK_RELEASE_TAG`.

## GitHub Actions Production Deploy

The repository includes a manual `Deploy Production` workflow. It verifies the app, pulls Vercel Production settings, builds with Vercel, deploys prebuilt output to Production, inspects the deployment, runs `npm run audit:production`, and checks recent Production error logs.

Add these GitHub repository secrets before using it:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The current linked Vercel project IDs are visible in `.vercel/project.json` on a linked local checkout. Do not commit a Vercel token.

Optional audit secrets:

- `NOCLICK_AUDIT_EMAIL`
- `NOCLICK_AUDIT_PASSWORD`
- `NOCLICK_AUDIT_TOKEN`

Use an admin or paid audit account when `NOCLICK_REQUIRE_SUBSCRIPTION=true`. If subscription enforcement is disabled, the audit can create and delete a temporary account.

## Accounts

The server provides:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/delete-account`
- `GET /v1/auth/me`

The app stores the session token locally and uses it for sync and AI planning. The old `NOCLICK_SYNC_TOKEN` still works as an admin/dev token.

Account deletion requires the signed-in user to post their own email as `confirmEmail`. It deletes the account record, sessions, provider tokens, runs, audit logs, OAuth state, and workspace state stored by NoClick AI. Public instructions are served at `/data-deletion`.

## Chat Automation and Connectors

The server provides:

- `POST /v1/chat`
- `GET /v1/runs`
- `POST /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/approve`
- `POST /v1/runs/:runId/execute`
- `GET /v1/connectors`
- `GET /v1/connectors/:provider/start`
- `GET /v1/connectors/:provider/callback`
- `POST /v1/connectors/:provider/disconnect`

Google Calendar and Gmail share the Google OAuth connection. Notion, Slack, Telegram, and KakaoTalk can prepare copyable content for Android/browser share UI without server credentials. Add provider credentials only when direct API delivery is required.

## Stripe Billing

The server provides:

- `GET /v1/billing/status`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/billing/webhook`

Configure Stripe Checkout with a recurring Price ID. Add this webhook endpoint in Stripe:

```text
https://api.your-domain.example/v1/billing/webhook
```

Listen only to required events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

The webhook verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` using the raw request body.

## Android Release Signing

Create a release keystore:

```bash
keytool -genkeypair -v -keystore C:/secure/noclickai-release.jks -alias noclickai -keyalg RSA -keysize 2048 -validity 10000
```

Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the real values. The file is ignored by Git.

Build a signed release bundle from Android Studio or with Gradle:

```bash
cd android
./gradlew bundleRelease
```

## Windows Code Signing

Electron Builder signs Windows builds when these variables are available:

```env
CSC_LINK=C:/secure/noclickai-code-signing.pfx
CSC_KEY_PASSWORD=replace-with-certificate-password
```

Then run:

```bash
npm run desktop:dist:signed
```

Use a real code-signing certificate before public distribution. Unsigned installers are acceptable only for internal testing.
