# NoClick AI

NoClick AI는 채팅 한 줄로 실행 계획, 앱 연결, 위험도별 승인, 실제 커넥터 실행, 기기 간 동기화를 제공하는 상용화 기반 앱입니다.

하나의 React 코어를 공유하고 아래 세 가지 형태로 실행합니다.

- Web/PWA: 브라우저와 설치형 웹앱
- Android App: Capacitor 기반 네이티브 Android 프로젝트
- Desktop Program: Electron 기반 Windows 데스크톱 프로그램

## 핵심 기능

- 채팅 중심 자동화: 요청, 계획, 승인, 실행 결과를 한 화면에서 처리
- AI 실행 엔진: 요청을 Calendar/Gmail/Notion/Slack/Telegram/KakaoTalk tool call로 변환
- 서버 OpenAI 키 기반 AI 플래너: 사용자가 API 키를 입력하지 않아도 `/v1/chat`과 `/v1/runs`로 실행 계획 생성
- OAuth 연결: Google Calendar/Gmail, Notion, Slack, KakaoTalk
- Bot/Share 연동: Telegram Bot, KakaoTalk 공유 fallback
- 위험도별 승인 정책: 낮음, 승인, 개별 승인, 차단
- 실행 로그, 실행 단계 상태, 로컬 채팅 저장
- Sync 서버 연동: Android 앱, 데스크톱 프로그램, 웹앱 사이에서 작업 상태와 템플릿 동기화

## 빠른 실행

```bash
npm install
npm run dev:full
```

- Web/PWA: `http://localhost:5173`
- Sync API: `http://127.0.0.1:8788`
- 개발용 Sync 토큰: `dev-sync-token`

앱에서 가입/로그인한 뒤 채팅창에 자동화 요청을 입력합니다. 서비스별 OAuth Client ID/Secret이 설정되어 있으면 앱 연결 버튼으로 Google, Notion, Slack, KakaoTalk 권한을 연결할 수 있습니다.

## 빌드와 검증

```bash
npm run lint
npm run build
```

Android/Windows처럼 설치형 앱을 빌드할 때는 앱 내부 기본 API 주소가 필요합니다. 배포 서버를 기본값으로 고정하려면 빌드 전에 `VITE_NOCLICK_SERVER_BASE_URL=https://noclickai-zeta.vercel.app`처럼 설정하세요.

## Android 앱

```bash
npm run android:sync
npm run android:open
```

`android/` 폴더가 Capacitor 네이티브 앱 프로젝트입니다. Android Studio에서 열어 APK/AAB를 빌드할 수 있습니다.

APK/AAB 빌드에는 JDK 21과 Android SDK가 필요합니다. 이 PC에는 JDK 21, Android Studio, Android SDK Platform 36, Build Tools가 설치되어 있고 `assembleDebug` 검증이 완료되었습니다.

실기기에서 로컬 Sync 서버를 쓰려면 `127.0.0.1` 대신 컴퓨터의 LAN IP 또는 HTTPS 배포 주소를 입력해야 합니다. 상용 배포에서는 반드시 HTTPS Sync 서버를 사용하세요.

## 데스크톱 프로그램

```bash
npm run desktop:dev
npm run desktop:dist
```

`desktop:dev`는 빌드된 앱을 Electron으로 실행합니다. `desktop:dist`는 Windows 설치 파일을 `release/`에 생성합니다.

## Sync 서버

```bash
set NOCLICK_SYNC_TOKEN=replace-with-long-random-token
npm run sync:server
```

API:

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `POST /v1/chat`
- `GET /v1/runs`
- `POST /v1/runs`
- `POST /v1/runs/:runId/approve`
- `POST /v1/runs/:runId/execute`
- `GET /v1/connectors`
- `GET /v1/connectors/:provider/start`
- `POST /v1/connectors/:provider/disconnect`
- `POST /v1/billing/checkout`
- `POST /v1/billing/portal`
- `POST /v1/billing/webhook`
- `GET /v1/readiness`
- `GET /v1/state?workspaceId=...`
- `PUT /v1/state`
- `POST /v1/plan`

Chat, Runs, Connectors, Sync 요청에는 로그인 세션 토큰 또는 `Authorization: Bearer <NOCLICK_SYNC_TOKEN>`이 필요합니다. 서버 데이터는 기본적으로 `server/data/workspaces.json`에 저장되며, 이 폴더는 Git에 포함하지 않습니다.

Public review pages:

- Privacy Policy: `/privacy`
- Terms of Service: `/terms`
- Downloads: `/downloads`

Current internal release:

- GitHub Release: `https://github.com/yangyu0330/NoClickAI/releases/tag/v0.1.0-internal.1`
- Android APK: `NoClickAI-Android-v0.1.0-internal.1.apk`
- Windows Installer: `NoClickAI-Windows-Setup-v0.1.0-internal.1.exe`

`POST /v1/plan`은 추가로 `X-OpenAI-Key` 헤더를 사용합니다. 이 값은 서버에 저장하지 않습니다.

기본 AI 모델은 `gpt-5-nano`입니다. OpenAI 공식 가격표 기준 텍스트 모델 중 가장 저렴한 GPT-5 계열이며, NoClick AI의 짧은 한국어 JSON 실행계획 생성에는 비용 대비 가장 적합한 기본값입니다. 필요하면 `NOCLICK_OPENAI_MODEL` 환경변수로 교체할 수 있습니다.

HTTPS, Stripe 구독, Android 릴리스 서명, Windows 코드 서명 설정은 [deployment.md](docs/deployment.md)를 참고하세요.
Google Calendar/Gmail 실제 OAuth 연결은 [google-oauth.md](docs/google-oauth.md)를 참고하세요.

## 데모 시나리오

1. `다음주 수요일 4시까지 계획서 제출`
2. `다음주 목요일 9시까지 통합회의`
3. `이번주 수요일까지 팀원들에게 내가 부여한 과제를 모두 해오도록 다시 공지`

## 실제 서비스화 연결 지점

현재 외부 앱 실행은 안전한 승인 기반 커넥터 모드입니다. 비밀값이 설정된 서비스는 실제 API를 호출하고, 미설정 서비스는 연결 필요/설정 필요 상태를 반환합니다.

- Google Calendar API: 일정 조회, 일정 생성
- Gmail API: 승인 후 실제 발송. 공개 기본값은 Gmail 제한 범위를 피하기 위해 앱 내부 검토 초안을 만들고, 실제 Gmail draft 생성은 `NOCLICK_ENABLE_GMAIL_DRAFTS=true`에서만 사용
- Notion API: 페이지 생성
- Slack API: 승인 후 메시지 전송
- Telegram Bot API: 봇 메시지 전송
- KakaoTalk: Kakao API 또는 공유창 fallback

민감 작업인 결제, 송금, 개인정보 대량 전송, 삭제 작업은 기본 차단 정책을 유지합니다.
