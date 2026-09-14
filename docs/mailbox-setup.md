# Learner Hub assessor email

The Learner Hub connects the trainee assessor's confirmed Hub email address. Action Plans are sent through that assessor's own provider; the support mailbox is not a sender or relay account. Existing Action Plan content, finalisation, saved records and styling are retained. Assessor Hub and resend-to-learner work are outside this change.

## What is implemented

- Google/Gmail/Workspace: retains the existing OAuth client, callback, scopes and refresh-token encryption key. Legacy encrypted Gmail tokens remain readable. Newly stored credentials use AES-256-GCM authenticated with owner ID and provider.
- Microsoft: OAuth authorization code + PKCE, persistent refresh tokens, delegated Graph `User.Read` and `Mail.Send`, and `offline_access`. Both personal Outlook and organizational Microsoft 365 accounts use the common endpoint. The primary `mail` returned by Graph must equal the confirmed Hub email; UPNs and arbitrary aliases are not accepted as substitute identities.
- iCloud/Yahoo/other approved servers: provider app passwords, encrypted in the private Supabase schema, authenticated SMTP through the included HTTPS mail service. SMTP username, From and envelope sender are fixed to the confirmed assessor email. Users cannot supply arbitrary hostnames, ports, sender addresses or separate SMTP usernames.
- Connection status, provider selection, setup-required messages, safe error messages, reconnect and disconnect controls. App passwords are never written to localStorage or saved in a draft/backup.
- Existing single-send event claim is retained. Explicit rejections can be retried; ambiguous send outcomes remain `unknown` and are not automatically resent. “Accepted” is not a receipt or delivery guarantee.

## Google: preserve the existing setup

Keep these existing Supabase secrets unchanged:

`ACTION_PLAN_GOOGLE_CLIENT_ID`, `ACTION_PLAN_GOOGLE_CLIENT_SECRET`, `ACTION_PLAN_TOKEN_KEY`.

Keep this authorized Web redirect URI:

`https://qwjejqqgkvkroqhmfglg.supabase.co/functions/v1/action-plan-mailbox/callback`

Keep Gmail API enabled and the existing `openid email https://www.googleapis.com/auth/gmail.send` consent scopes. An assessor authorizes their own account from the Hub. While Google's app is in Testing, actual assessor accounts must be listed as test users; external apps in Testing can have seven-day refresh-token expiry. Public rollout requires the appropriate consent-screen publication/verification for the requested scopes. The Google Cloud owner account is not the sending mailbox.

## Microsoft: administrator action required

1. Create a Microsoft Entra app registration supporting **accounts in any organizational directory and personal Microsoft accounts**.
2. Add the redirect URI above as a **Web** redirect (not SPA). Keep the client secret on the server.
3. Add Microsoft Graph **delegated** `User.Read` and `Mail.Send`; request `openid email offline_access` through the connection flow. Do not use application-wide mail permissions or shared mailbox permissions.
4. Create a client secret and store its value as `ACTION_PLAN_MICROSOFT_CLIENT_SECRET` in Supabase Edge Function secrets. Store the application/client ID as `ACTION_PLAN_MICROSOFT_CLIENT_ID`. Record the secret expiry and rotate it before expiry.
5. Some organizations require their tenant administrator's consent. Each assessor must then connect the account whose primary sending email matches their confirmed Hub email.

The UI shows Microsoft as awaiting setup until both secrets exist. The direct MIME send path deliberately limits the supplied PDF to 2,800,000 base64 characters (approximately 2.1 MB binary) to stay under Graph's request limit after MIME encoding. Larger PDFs can still be downloaded and sent manually. Upload-session permissions and draft-mail access have not been added.

## iCloud, Yahoo and company mail: administrator action required

Supabase blocks outbound ports 25 and 587; Apple's documented SMTP port is 587. The included `mailbox-relay/` service runs on a host with SMTP egress, behind a trusted HTTPS endpoint. It sends via the assessor's own mailbox, not a PT Academy mailbox. No hosting account, paid service or new credentials have been provisioned by this change.

1. Deploy `mailbox-relay/Dockerfile` using Node 24, with outbound DNS and ports 465/587 permitted. Expose `/mailbox` only through HTTPS. `/health` returns no sensitive data. Use **one process/replica** with no proxy retries of POST requests; request nonce replay protection is in memory. Multi-replica operation needs a shared atomic replay store before scaling.
2. Generate a new, random signing secret of at least 32 characters. Configure `ACTION_PLAN_SMTP_RELAY_KEY` on both the service and Supabase. This is separate from `ACTION_PLAN_TOKEN_KEY`.
3. Set `ACTION_PLAN_SMTP_RELAY_URL` in Supabase to the full HTTPS `/mailbox` endpoint. Do not put either secret in the frontend, repository or URL. Disable request-body and authorization-header logging in hosting/proxy/APM settings; bodies contain app passwords in transit over TLS. The service does not persist credentials or log SMTP conversations.
4. iCloud uses `smtp.mail.me.com:587` with mandatory STARTTLS and an app-specific password. Supported built-in address domains: icloud.com, me.com, mac.com.
5. Yahoo uses `smtp.mail.yahoo.com:465` with TLS and a generated app password. Built-in domains: yahoo.com, yahoo.co.uk, ymail.com, rocketmail.com. Other Yahoo regional domains can be approved through the company-domain configuration.
6. For company/custom domains (including iCloud custom domains), set `ACTION_PLAN_SMTP_DOMAINS` **on the relay only** to an administrator-reviewed JSON map such as `{"example.com":{"host":"smtp.example.com","port":587}}`. Use the actual mailbox host, which must authenticate the full email address as SMTP username. Hosts with separate usernames, unsupported authentication mechanisms, unverified sender aliases or private network addresses are not supported by this path. For Google/Microsoft-hosted company domains, choose their OAuth provider instead.
7. Each assessor generates an app password in their provider's security settings and enters it into the Hub's password field. Do not collect their main account password or ask them to paste credentials into chat. Connection verification authenticates SMTP but sends no test message. SMTP authentication does not prove final recipient delivery; test an authorized Action Plan after connecting.

SMTP submission does not necessarily save a copy in Sent Items. For an ambiguous SMTP outcome, check with the provider/recipient before any manual resend. Disconnect removes the Hub's stored credential and invalidates pending connection attempts. Provider grants/app passwords remain revocable in the provider's security settings. A send already in progress may complete after disconnect.

## Database and function deployment

Apply the additive mailbox migration before deploying `supabase/functions/action-plan-mailbox/index.ts` and `security.ts`. It adds provider/status columns, expiring state metadata and private connection guards. Existing rows default to Google. No Action Plan records or mail events are deleted. The private schema has RLS enabled and no browser-role grants/policies by design.

The function retains `verify_jwt=false` because OAuth redirects do not carry a Hub JWT. Every POST authenticates its bearer token using Supabase `auth.getUser` and requires a confirmed email; callbacks instead require single-use expiring state, PKCE and provider identity verification. Preserve this setting when deploying.

Deploy the frontend only after the function. Unconfigured provider paths remain visibly unavailable, so their secrets can be added later. Keep the existing encryption key: replacing it without a credential migration would invalidate stored connections. There are no real secrets in this source.

## Verification

Install root development dependencies and the relay dependency with `npm ci` and `npm --prefix mailbox-relay ci`, then run `npm test`. Tests use synthetic users, a local PGlite Postgres database and mocked provider responses; no live email is sent. They cover migration compatibility, AES owner/provider binding, existing Gmail ciphertext, PKCE replay and mismatches, Graph 202 and refresh-token rotation, owner checks, duplicate prevention, uncertain sends, disconnect races, SMTP sender restrictions, relay signatures/private-address blocking, and UI setup/error/password handling. The PGlite test adapter does not emulate production advisory-lock concurrency across database sessions.

Run Deno type checking for the Edge Function. Final validation with real Google/Microsoft consent and iCloud/Yahoo app passwords must be performed by authorized mailbox owners; simulated tests cannot establish provider-console readiness or real delivery.

## References

- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Microsoft sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Apple iCloud mail settings](https://support.apple.com/en-ie/102525)
- [Yahoo SMTP settings](https://uk.help.yahoo.com/kb/new-yahoo-mail/pop-settings-sln4724.html)
- [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
