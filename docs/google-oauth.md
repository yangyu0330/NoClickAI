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
6. Create OAuth client:
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
```

Then redeploy production.

## 3. App Test

1. Sign in to NoClickAI with the admin account.
2. Open the connector panel.
3. Click Google Calendar or Gmail connect.
4. Approve the Google consent screen.
5. Confirm both Google Calendar and Gmail show connected.
6. Try:

```text
내일 오전 9시에 테스트 회의 일정을 만들고, 나에게 메일 초안을 만들어줘
```

Approve and execute the run. The expected result is one Google Calendar event and one Gmail draft.

## Notes

- Calendar and Gmail share one Google OAuth connection.
- Gmail support creates drafts only; it does not send email automatically.
- For public user access outside test users, Google may require OAuth app verification and policy review.

Official references:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/gmail/api/auth/scopes
