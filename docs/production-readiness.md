# Production Readiness

이 문서는 NoClick AI를 실제 서비스로 운영하기 위한 기준입니다.

## 현재 포함된 상용화 기반

- 하나의 UI 코어를 Web/PWA, Android, Electron Desktop에서 공유
- 로컬 저장/복원으로 앱 재실행 후에도 작업 상태 유지
- Sync 서버로 여러 기기 간 히스토리, 연결 상태, 현재 계획 동기화
- 개인 API Key는 기기 로컬에만 저장하고 Sync 대상에서 제외
- 위험도별 승인 정책으로 메시지 발송, 일정 등록, 제출 폼 입력을 자동 실행 전에 차단
- Android 네이티브 프로젝트와 Windows 설치 파일 빌드 파이프라인 제공

## 운영 전 필수 보강

1. Sync 서버 HTTPS 배포
   - 예: Vercel Functions, Fly.io, Render, AWS Lightsail, Cloud Run
   - `NOCLICK_SYNC_TOKEN`은 최소 32바이트 이상 랜덤 문자열 사용
   - 운영에서는 `dev-sync-token` 사용 금지

2. 사용자 인증
   - OAuth 로그인 또는 패스키 기반 사용자 계정
   - 워크스페이스별 접근 제어와 토큰 회전

3. 실제 앱 어댑터
   - Google Calendar, Gmail, Notion, Slack, Discord API는 서버에서 OAuth 토큰으로 실행
   - 데스크톱 Browser Agent는 Playwright 실행 권한과 사용자 승인 로그 필요

4. 감사 로그
   - 실행 계획, 승인자, 실행 시각, 대상 앱, 되돌리기 가능 여부를 서버에 저장
   - 민감 작업은 원본 요청, AI 계획, 사용자 승인 기록을 함께 보관

5. 배포 패키징
   - Android: Play Console용 AAB 서명 키 관리
   - Android build machine: JDK 21, Android SDK, Gradle cache 준비
   - Desktop: Windows 코드 서명 인증서 적용
   - Web/PWA: HTTPS 도메인, CSP, Service Worker 캐시 버전 관리

## 동기화 데이터 정책

Sync 대상:

- 작업 히스토리
- OAuth 연결 상태 표시값
- 현재 실행 계획
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
