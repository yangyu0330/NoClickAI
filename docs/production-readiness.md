# Production Readiness

이 문서는 NoClick AI를 실제 운영 서비스로 배포하기 위한 기준입니다.

## 현재 구현된 운영 기반

- 하나의 React UI를 Web/PWA, Android, Windows 데스크톱에서 공유합니다.
- Vercel HTTPS 배포와 API 라우팅이 구성되어 있습니다.
- Neon Postgres를 사용해 계정, 세션, 연결 상태, 실행 기록, 감사 로그를 저장합니다.
- 이메일/비밀번호 계정, 세션 토큰, 계정 삭제 기능이 있습니다.
- `NOCLICK_ADMIN_EMAILS`에 등록된 어드민 계정은 결제 없이 사용할 수 있습니다.
- OpenAI 호출은 서버에서 처리하며 기본 모델은 `gpt-5-nano`입니다.
- Google OAuth로 Calendar와 Gmail을 연결할 수 있습니다.
- Gmail 발송은 고위험 작업으로 분류되어 승인 전에는 실행되지 않습니다.
- Notion, Slack, Telegram, KakaoTalk은 직접 API 자격증명 없이도 복사/공유 가능한 prepared fallback을 제공합니다.
- Stripe Checkout, Billing Portal, webhook 처리 엔드포인트가 구현되어 있습니다.
- `/privacy`, `/terms`, `/downloads`, `/data-deletion` 공개 검토 페이지가 있습니다.
- `/v1/readiness`와 `npm run audit:production`으로 운영 준비 상태를 점검합니다.
- Android APK/AAB와 Windows 설치 파일 빌드 경로가 준비되어 있습니다.

## 운영 전 필수 확인

1. Vercel Production 환경 변수
   - GitHub Actions secret `VERCEL_TOKEN`: Vercel Account Tokens 페이지에서 새 토큰을 발급해 갱신합니다.
   - GitHub Actions secret `VERCEL_ORG_ID`
   - GitHub Actions secret `VERCEL_PROJECT_ID`
   - `NOCLICK_PUBLIC_APP_URL`
   - `NOCLICK_SERVER_BASE_URL`
   - `NOCLICK_ALLOWED_ORIGIN`
   - `NOCLICK_SYNC_TOKEN`
   - `NOCLICK_TOKEN_ENCRYPTION_KEY`: `NOCLICK_SYNC_TOKEN`과 다른 긴 랜덤 값이어야 합니다.
   - `DATABASE_URL` 또는 `POSTGRES_URL`
   - `OPENAI_API_KEY`
   - `NOCLICK_OPENAI_MODEL`
   - `NOCLICK_ADMIN_EMAILS`
   - `NOCLICK_EXPOSE_ERROR_DETAILS=false`

2. Google OAuth
   - Authorized redirect URI: `https://noclickai-zeta.vercel.app/v1/connectors/google/callback`
   - `GOOGLE_REDIRECT_URI`는 `${NOCLICK_SERVER_BASE_URL}/v1/connectors/google/callback`과 정확히 일치해야 하며 HTTPS여야 합니다.
   - 테스트 모드에서는 사용할 Google 계정을 test user로 추가해야 합니다.
   - 공개 상용 서비스 전에는 Google OAuth app verification을 완료해야 합니다.
   - 검증 완료 후 `NOCLICK_GOOGLE_OAUTH_VERIFIED=true`를 Vercel Production에 설정합니다.
   - `NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE`에는 승인 날짜나 내부 티켓처럼 비밀이 아닌 증거 표식을 설정합니다.
   - 기본 공개 범위는 Gmail send-only입니다. `gmail.compose`는 제한 범위이므로 필요한 경우에만 `NOCLICK_ENABLE_GMAIL_DRAFTS=true`를 사용합니다.

3. Stripe 결제
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - 공개 출시 readiness에서는 `STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_PRICE_ID=price_...`, `STRIPE_WEBHOOK_SECRET=whsec_...` 형식을 요구합니다.
   - `STRIPE_SUCCESS_URL`
   - `STRIPE_CANCEL_URL`
   - `STRIPE_PORTAL_RETURN_URL`
   - 유료 접근을 강제하려면 `NOCLICK_REQUIRE_SUBSCRIPTION=true`를 설정합니다.

4. 선택형 직접 API 연동
   - Notion 직접 페이지 생성을 원하면 `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_PARENT_PAGE_ID`를 설정합니다.
   - Slack 직접 전송을 원하면 `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_DEFAULT_CHANNEL_ID`를 설정합니다.
   - Telegram 직접 bot 전송을 원하면 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`를 설정합니다.
   - Kakao 직접 메시지 API는 별도 심사와 권한이 필요합니다.

5. 앱 패키지 배포
   - Android: Android Studio에서 signed AAB를 만들고 Play Console에 업로드합니다.
   - Windows: 신뢰 가능한 코드 서명 인증서를 electron-builder에 연결합니다.
   - 공개 배포 전 다운로드 페이지와 GitHub release asset이 일치하는지 확인합니다.
   - GitHub Actions `Build App Packages` 워크플로는 signing secret이 준비되면 APK/AAB/Windows 설치 파일과 checksum을 만들 수 있습니다.
   - signed AAB 검증/업로드 후 `NOCLICK_ANDROID_RELEASE_SIGNED=true`를 설정합니다.
   - `NOCLICK_ANDROID_RELEASE_EVIDENCE`에는 `ANDROID-SIGNING-EVIDENCE.txt`와 Play Console 릴리스/검증 표식을 바탕으로 한 비밀이 아닌 표식을 설정합니다.
   - Windows installer Authenticode 검증 후 `NOCLICK_WINDOWS_CODE_SIGNED=true`를 설정합니다.
   - `NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE`에는 `WINDOWS-SIGNING-EVIDENCE.txt`의 signer/thumbprint 검증 표식을 설정합니다.

## 검증 명령

커밋 전 로컬 검증:

```bash
node --check server/sync-server.mjs
node --check scripts/production-audit.mjs
node --check scripts/apply-launch-env.mjs
node --check scripts/collect-launch-evidence.mjs
node --check scripts/setup-stripe-launch.mjs
node --check scripts/launch-env-smoke.mjs
node --check scripts/launch-evidence-smoke.mjs
node --check scripts/stripe-launch-smoke.mjs
node --check scripts/billing-webhook-smoke.mjs
node --check scripts/readiness-smoke.mjs
npm audit --audit-level=high
npm run lint
npm run test:launch-evidence
npm run test:launch-env
npm run test:launch-stripe
npm run test:billing
npm run test:readiness
npm run build
git diff --check
```

프로덕션 배포 후 검증:

```bash
npm run audit:production
npm run audit:production:parallel -- --runs 2
npm run audit:production -- --strict-launch
npm run audit:production -- --require-admin
npx vercel@latest inspect https://noclickai-zeta.vercel.app
npx vercel@latest logs --level error --since 1h --environment production --no-branch --no-follow
```

GitHub Actions 배포 토큰 확인:

```bash
npx vercel@latest whoami --token "$VERCEL_TOKEN"
```

PowerShell에서 새 토큰을 GitHub secret에 넣는 예:

```powershell
$env:VERCEL_TOKEN='새 Vercel account token'
gh secret set VERCEL_TOKEN --repo yangyu0330/NoClickAI --body $env:VERCEL_TOKEN
```

`npm run audit:production`은 다음을 확인합니다.

- `/health`
- production security headers, including HSTS, CSP frame-ancestors, nosniff, and restrictive permissions
- `/health.commitSha`와 현재 git `HEAD`의 배포 일치 여부
- `/` 앱 셸, JS/CSS 번들, PWA manifest, service worker
- service worker의 인증 API 응답 캐시 제외
- `/privacy`, `/terms`, `/downloads`, `/data-deletion`
- 정적 파일 경로 traversal 차단
- 인증된 `/v1/readiness`
- billing status, checkout, portal의 현재 환경별 동작
- `--require-admin` 또는 `NOCLICK_AUDIT_REQUIRE_ADMIN=true`일 때 어드민 결제 우회 계정 여부
- Stripe webhook의 서명 없는 요청 거부
- `NOCLICK_REQUIRE_SUBSCRIPTION=true`일 때 무료 계정의 paid automation API 접근 차단
- 병렬 감사에서 계정/세션/실행 기록 동시 저장 안정성
- Notion prepared-page 자동화
- Slack prepared-message 자동화
- Telegram prepared-message 자동화
- KakaoTalk share fallback 자동화
- Gmail 고위험 승인 게이트
- 임시 계정 삭제 후 인증 토큰 무효화

## 위험 등급 정책

- Low: 초안 생성, 복사 가능한 텍스트 준비, 공유 fallback 준비
- Medium: 사용자의 외부 상태를 바꿀 수 있는 작업
- High: Gmail 발송, Slack 직접 전송, Telegram 직접 전송, Notion 직접 페이지 생성
- Blocked: 결제, 송금, 계정 삭제, 보안 설정 변경처럼 자동 실행하면 안 되는 작업

High 작업은 실행 전에 반드시 승인 상태가 되어야 하며, 승인 전 `/execute` 호출은 결과를 만들면 안 됩니다.

## 현재 남은 공개 출시 블로커

- GitHub Actions `VERCEL_TOKEN` 갱신 후 `Deploy Production` CLI 배포/로그 확인 복구
- `allow_git_integration_fallback=true`로 Vercel Git integration 배포 커밋 검증 확인
- Stripe live secret, recurring Price ID, webhook secret 설정
- `NOCLICK_REQUIRE_SUBSCRIPTION=true` 설정
- Google OAuth 공개 검증
- `NOCLICK_GOOGLE_OAUTH_VERIFIED=true`와 `NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE` 설정
- Android signed AAB 및 Play Console 검토
- `NOCLICK_ANDROID_RELEASE_SIGNED=true`와 `NOCLICK_ANDROID_RELEASE_EVIDENCE` 설정
- Windows 코드 서명 인증서
- `NOCLICK_WINDOWS_CODE_SIGNED=true`와 `NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE` 설정
- 선택 사항: Notion/Slack/Telegram/Kakao 직접 API 전송 자격증명

이 항목들이 완료되기 전에도 어드민 계정과 prepared fallback 중심의 내부 운영은 가능합니다.
