# NoClick AI

NoClick AI는 자연어 목적 입력으로 실행 계획, 위험도별 승인, 자동화 로그, 기기 간 동기화를 제공하는 상용화 기반 앱입니다.

하나의 React 코어를 공유하고 아래 세 가지 형태로 실행합니다.

- Web/PWA: 브라우저와 설치형 웹앱
- Android App: Capacitor 기반 네이티브 Android 프로젝트
- Desktop Program: Electron 기반 Windows 데스크톱 프로그램

## 핵심 기능

- 자연어 목적 입력과 대표 예시 3개
- AI 실행 계획 카드: 목표, 마감일, 필요한 앱, 단계, 위험도
- 개인 API Key 입력: 코드에 하드코딩하지 않고 로컬 기기에만 저장
- OAuth 연결 상태 관리: Google Calendar, Gmail, Notion, Slack, Discord, Browser Agent
- 위험도별 승인 정책: 낮음, 승인, 개별 승인, 차단
- 실행 로그, 완료 히스토리, 로컬 저장/복원
- Sync 서버 연동: Android 앱, 데스크톱 프로그램, 웹앱 사이에서 작업 상태 동기화

## 빠른 실행

```bash
npm install
npm run dev:full
```

- Web/PWA: `http://localhost:5173`
- Sync API: `http://127.0.0.1:8788`
- 개발용 Sync 토큰: `dev-sync-token`

앱의 `기기 연동` 패널에서 서버 주소, 워크스페이스 ID, Sync 토큰을 입력한 뒤 `업로드`와 `가져오기`로 연동합니다. 개인 API Key는 보안상 동기화하지 않습니다.

## 빌드와 검증

```bash
npm run lint
npm run build
```

## Android 앱

```bash
npm run android:sync
npm run android:open
```

`android/` 폴더가 Capacitor 네이티브 앱 프로젝트입니다. Android Studio에서 열어 APK/AAB를 빌드할 수 있습니다.

APK/AAB 빌드에는 JDK 21과 Android SDK가 필요합니다. 이 PC에는 JDK와 Android Studio를 설치했지만, Android SDK는 Android Studio 첫 실행 설정에서 설치해야 합니다.

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
- `GET /v1/state?workspaceId=...`
- `PUT /v1/state`

요청에는 `Authorization: Bearer <NOCLICK_SYNC_TOKEN>`이 필요합니다. 서버 데이터는 기본적으로 `server/data/workspaces.json`에 저장되며, 이 폴더는 Git에 포함하지 않습니다.

## 데모 시나리오

1. `다음주 수요일 4시까지 계획서 제출`
2. `다음주 목요일 9시까지 통합회의`
3. `이번주 수요일까지 팀원들에게 내가 부여한 과제를 모두 해오도록 다시 공지`

## 실제 서비스화 연결 지점

현재 외부 앱 실행은 안전한 승인 기반 데모 모드입니다. 상용 서비스에서는 아래 어댑터를 서버 API 뒤에 붙입니다.

- Google Calendar API: 일정 조회, 일정 생성
- Gmail API: 메일 초안 생성, 사용자 승인 후 발송
- Notion API 또는 Google Docs API: 할 일 보드와 문서 초안 생성
- Slack/Discord API: 메시지 초안, 예약 발송
- Playwright 기반 Browser Agent: 제출 폼 입력, 최종 제출 전 사용자 승인

민감 작업인 결제, 송금, 개인정보 대량 전송, 삭제 작업은 기본 차단 정책을 유지합니다.
