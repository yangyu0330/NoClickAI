# Google Calendar/Gmail OAuth Setup

NoClickAI can open the Google consent screen from the app, but Google still requires a Web OAuth client to exist first. Use this setup for the production URL.

## 1. Google Cloud

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable these APIs:
   - Google Calendar API
   - Gmail API
4. Configure OAuth consent screen in Testing mode.
5. Add your own Google account as a test user.
6. Add app links:
   - Application home page: `https://noclickai-zeta.vercel.app`
   - Privacy policy: `https://noclickai-zeta.vercel.app/privacy`
   - Terms of service: `https://noclickai-zeta.vercel.app/terms`
7. Create OAuth client:
   - Application type: Web application
   - Authorized redirect URI:

```text
https://noclickai-zeta.vercel.app/v1/connectors/google/callback
```

## 2. Vercel Environment Variables

Add these to the `noclickai` Vercel project Production environment:

```text
GOOGLE_CLIENT_ID=<client-id-from-google>
GOOGLE_CLIENT_SECRET=<client-secret-from-google>
GOOGLE_REDIRECT_URI=https://noclickai-zeta.vercel.app/v1/connectors/google/callback
NOCLICK_ENABLE_GMAIL_DRAFTS=false
```

Then redeploy production.

`GET /v1/readiness` checks that `GOOGLE_REDIRECT_URI` exactly matches `${NOCLICK_SERVER_BASE_URL}/v1/connectors/google/callback` and uses HTTPS. The same exact URI must be present in the Google Cloud OAuth web client's authorized redirect URIs.

Default public scope set:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`

The default Gmail mode intentionally avoids `https://www.googleapis.com/auth/gmail.compose`, because Google classifies `gmail.compose` as a restricted scope. In default mode, NoClick AI prepares review drafts inside the app and uses Gmail only for approved sends. Set `NOCLICK_ENABLE_GMAIL_DRAFTS=true` only if you plan to complete restricted-scope verification and any required security assessment.

## 3. App Test

1. Sign in to NoClickAI with the admin account.
2. Open the connector panel.
3. Click Google Calendar or Gmail connect.
4. Approve the Google consent screen.
5. Confirm both Google Calendar and Gmail show connected.
6. Try:

```text
내일 오전 9시에 테스트 회의 일정을 만들고, 나에게 메일 검토 초안을 준비해줘
```

Approve and execute the run. The expected result is one Google Calendar event and one NoClick AI review draft. If `NOCLICK_ENABLE_GMAIL_DRAFTS=true`, the expected mail result is one Gmail draft instead.

To test actual Gmail sending, use a separate request that explicitly asks to send email, then approve the high-risk step before executing:

```text
Send a Gmail test email to myself with subject NoClick AI send verification.
```

The expected result is one Gmail message in the Sent folder. Do not use this test with someone else's address unless they expect the email.

## Notes

- Calendar and Gmail share one Google OAuth connection.
- Gmail support prepares in-app review drafts by default and can send email when the user explicitly asks for sending. Sending is always high risk and requires approval before execution.
- Actual Gmail draft creation is optional and disabled by default to avoid requesting the restricted `gmail.compose` scope.
- For public user access outside test users, Google may require OAuth app verification and policy review.

Official references:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
