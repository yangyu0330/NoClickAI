# Production Readiness

이 문서는 NoClick AI를 실제 서비스로 운영하기 위한 기준입니다.

## 현재 포함된 상용화 기반

- 하나의 UI 코어를 Web/PWA, Android, Electron Desktop에서 공유
- 로컬 저장/복원으로 앱 재실행 후에도 작업 상태 유지
- Sync 서버로 여러 기기 간 히스토리, 연결 상태, 현재 계획 동기화
- 이메일/비밀번호 계정, 로컬 세션 토큰, 워크스페이스별 동기화 인증
- Stripe Checkout 구독 생성, Billing Portal 연결, 서명 검증 웹훅 처리
- 인증서 경로가 제공되면 Sync 서버를 HTTPS로 직접 실행 가능
- 개인 API Key는 기기 로컬에만 저장하고 Sync 대상에서 제외
- AI 플래너는 서버 프록시를 통해 OpenAI Responses API를 호출하고 실패 시 규칙 기반 플래너로 대체
- 기본 AI 모델은 `gpt-5-nano`로 설정해 계획 생성 비용을 최소화하고, 품질이 부족한 워크스페이스만 `NOCLICK_OPENAI_MODEL`로 상위 모델을 선택
- 자동화 템플릿, 히스토리 검색, JSON 백업/복원, 제품 성과 지표 포함
- 위험도별 승인 정책으로 메시지 발송, 일정 등록, 제출 폼 입력을 자동 실행 전에 차단
- Android 네이티브 프로젝트와 Windows 설치 파일 빌드 파이프라인 제공

## 운영 전 필수 보강

1. Sync 서버 HTTPS 배포
   - 예: Vercel Functions, Fly.io, Render, AWS Lightsail, Cloud Run
   - `NOCLICK_SYNC_TOKEN`은 최소 32바이트 이상 랜덤 문자열 사용
   - 운영에서는 `dev-sync-token` 사용 금지
   - `NOCLICK_ALLOWED_ORIGIN`으로 제품 도메인만 CORS 허용

2. 사용자 인증
   - 현재 이메일/비밀번호 계정과 세션 토큰 포함
   - 운영 전 이메일 인증, 비밀번호 재설정, 토큰 회전, 패스키 또는 OAuth 추가 권장

3. 실제 앱 어댑터
   - Google Calendar, Gmail, Notion, Slack, Discord API는 서버에서 OAuth 토큰으로 실행
   - 데스크톱 Browser Agent는 Playwright 실행 권한과 사용자 승인 로그 필요
   - OpenAI API Key는 장기 저장하지 않고 사용자가 선택한 개인 키 또는 결제 계정과 분리

4. 감사 로그
   - 실행 계획, 승인자, 실행 시각, 대상 앱, 되돌리기 가능 여부를 서버에 저장
   - 민감 작업은 원본 요청, AI 계획, 사용자 승인 기록을 함께 보관

5. 배포 패키징
   - Android: Play Console용 AAB 서명 키 관리
   - Android build machine: JDK 21, Android SDK, Gradle cache 준비
   - Desktop: Windows 코드 서명 인증서 적용
   - Web/PWA: HTTPS 도메인, CSP, Service Worker 캐시 버전 관리

6. 결제 운영
   - Stripe live secret key, recurring Price ID, webhook secret 설정
   - 웹훅 이벤트는 필요한 이벤트만 수신
   - 운영에서는 `NOCLICK_REQUIRE_SUBSCRIPTION=true`로 미구독 사용자의 AI/Sync 접근 차단

## 동기화 데이터 정책

Sync 대상:

- 작업 히스토리
- OAuth 연결 상태 표시값
- 현재 실행 계획
- 자동화 템플릿
- 기기 이름과 마지막 업데이트 시각

Sync 제외:

- 개인 LLM API Key
- OAuth access token/refresh token
- 결제, 송금, 주민등록번호 등 민감정보

## 위험도 정책

- Low: 요약, 초안, 후보 시간 계산은 자동 처리 가능
- Medium: 캘린더 일정 생성, Notion 페이지 생성은 승인 필요
- High: 메일 발송, 외부 메시지 전송, 파일 제출은 개별 승인 필요
- Blocked: 결제, 송금, 계정 변경, 삭제 작업은 자동 실행 금지
