import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import postgres from 'npm:postgres@3.4.5';
import {isProvider, normalEmail, validEmail, b64, url64, credentialKey, encrypt, decrypt, assertIdentity, validPdf, MailboxError, type Provider} from './security.ts';

const origin = 'https://cava-learner-hub.pages.dev';
const home = origin + '/CAVA-LMS/?tab=actions';
const base = Deno.env.get('SUPABASE_URL')!;
// Keep the previously registered Google callback unchanged.
const redirect = base + '/functions/v1/action-plan-mailbox/callback';
const googleId = Deno.env.get('ACTION_PLAN_GOOGLE_CLIENT_ID');
const googleSecret = Deno.env.get('ACTION_PLAN_GOOGLE_CLIENT_SECRET');
const microsoftId = Deno.env.get('ACTION_PLAN_MICROSOFT_CLIENT_ID');
const microsoftSecret = Deno.env.get('ACTION_PLAN_MICROSOFT_CLIENT_SECRET');
const rawKey = Deno.env.get('ACTION_PLAN_TOKEN_KEY');
const relayUrl = Deno.env.get('ACTION_PLAN_SMTP_RELAY_URL');
const relayKey = Deno.env.get('ACTION_PLAN_SMTP_RELAY_KEY');
const admin = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false, autoRefreshToken: false}});
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {prepare: false, max: 3, connect_timeout: 10});
const headers = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store'};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Content-Type': 'application/json'}});
const microsoftScope = 'openid email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send';
const googleScope = 'openid email https://www.googleapis.com/auth/gmail.send';
const request = (url: string, init: RequestInit = {}) => fetch(url, {...init, redirect: 'error', signal: AbortSignal.timeout(25000)});
const key = () => credentialKey(rawKey!);
const seal = async (secret: string, owner: string, provider: Provider) => encrypt(secret, await key(), owner, provider);
const open = async (cipher: string, owner: string, provider: Provider) => decrypt(cipher, await key(), owner, provider);
function configured(provider: Provider) {
  if (!rawKey) return false;
  if (provider === 'google') return Boolean(googleId && googleSecret);
  if (provider === 'microsoft') return Boolean(microsoftId && microsoftSecret);
  return Boolean(relayUrl?.startsWith('https://') && relayKey && relayKey.length >= 32);
}
function requireConfigured(provider: Provider) {
  if (!configured(provider)) throw new MailboxError('setup_required', 'This email provider is awaiting administrator setup. Your saved plans are safe.', 503);
}
async function oauthToken(provider: Provider, params: Record<string, string>) {
  const google = provider === 'google';
  const response = await request(google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: (google ? googleId : microsoftId)!, client_secret: (google ? googleSecret : microsoftSecret)!, ...(!google ? {scope: microsoftScope} : {}), ...params})
  });
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw new MailboxError('provider_unavailable', 'Your email provider is temporarily unavailable. Try again later.', 503);
    throw new MailboxError('reconnect_required', 'Your mailbox permission has expired or was declined. Reconnect your email.', 409);
  }
  const tokens = await response.json();
  if (typeof tokens.access_token !== 'string') throw new MailboxError('reconnect_required', 'Reconnect your email to restore sending permission.', 409);
  if (tokens.scope && !tokens.scope.split(' ').some((s: string) => google ? s === 'https://www.googleapis.com/auth/gmail.send' : /(^|\/)Mail.Send$/i.test(s))) {
    throw new MailboxError('reconnect_required', 'Reconnect your email and allow permission to send Action Plans.', 409);
  }
  return tokens;
}
async function identity(provider: Provider, accessToken: string) {
  const response = await request(provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {headers: {Authorization: 'Bearer ' + accessToken}});
  if (!response.ok) throw new MailboxError('identity_unavailable', 'Your mailbox identity could not be verified. Try connecting again.', 409);
  const profile = await response.json();
  if (provider === 'google' && profile.email_verified !== true) throw new MailboxError('identity_mismatch', 'Your Google mailbox must have a verified email address.');
  // Microsoft UPN/email claims are not proof of the sending address. Fail closed if Graph has no primary mail value.
  const email = normalEmail(provider === 'google' ? profile.email : profile.mail);
  if (!validEmail(email)) throw new MailboxError('identity_mismatch', 'This account does not expose a verified primary sending mailbox. Use the account matching your Hub email.');
  return email;
}
async function relay(body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(relayKey!), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = url64(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(timestamp + '.' + nonce + '.' + payload))));
  const response = await request(relayUrl!, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Mailbox-Time': timestamp, 'X-Mailbox-Nonce': nonce, 'X-Mailbox-Signature': signature}, body: payload});
  if (!response.ok) throw new MailboxError('relay_unavailable', 'The email connection service is unavailable. Ask the administrator to check its setup.', 503);
  return await response.json();
}
async function callback(url: URL) {
  const state = url.searchParams.get('state');
  if (!state) return Response.redirect(home + '&mailbox=expired', 303);
  try {
    // Consuming the state precedes both cancellation and code exchange, so callbacks cannot be replayed.
    const rows = await sql`delete from action_plan_private.oauth_states where state=${state} and expires_at>now() returning owner_id,verifier,provider,expected_email`;
    if (rows.length !== 1) return Response.redirect(home + '&mailbox=expired', 303);
    const {owner_id: owner, verifier, provider, expected_email: expected} = rows[0];
    if (!isProvider(provider) || !['google','microsoft'].includes(provider)) throw new Error('Invalid provider');
    if (url.searchParams.has('error')) return Response.redirect(home + '&mailbox=cancelled', 303);
    const code = url.searchParams.get('code');
    if (!code) return Response.redirect(home + '&mailbox=cancelled', 303);
    requireConfigured(provider);
    const tokens = await oauthToken(provider, {code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect});
    const email = await identity(provider, tokens.access_token);
    const {data, error} = await admin.auth.admin.getUserById(owner);
    if (error || !data.user?.email_confirmed_at || !data.user.email) throw new MailboxError('identity_mismatch', 'Sign in again.');
    assertIdentity(data.user.email, email);
    // Legacy in-progress Google states can have no expected_email; they still require current identity matching.
    if (expected) assertIdentity(expected, email);
    if (!tokens.refresh_token) throw new MailboxError('reconnect_required', 'Offline permission is required.');
    // A disconnect/new connection that happened during provider authorization invalidates this callback.
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${owner},0))`;
      const gates = await tx`select generation from action_plan_private.connection_guards where owner_id=${owner}`;
      if (gates.length && gates[0].generation !== state) throw new MailboxError('expired', 'Connection superseded.');
      const cipher = await seal(tokens.refresh_token, owner, provider);
      await tx`insert into action_plan_private.mailboxes(owner_id,email,provider,token_cipher,connection_status) values(${owner},${email},${provider},${cipher},'connected') on conflict(owner_id) do update set email=excluded.email,provider=excluded.provider,token_cipher=excluded.token_cipher,connection_status='connected',updated_at=now()`;
    });
    return Response.redirect(home + '&mailbox=connected', 303);
  } catch (error) {
    const code = error instanceof MailboxError && ['identity_mismatch','expired','setup_required'].includes(error.code) ? error.code : 'connection_failed';
    return Response.redirect(home + '&mailbox=' + code, 303);
  }
}
export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/callback')) return await callback(url);
    if (req.method !== 'POST') return json({error: 'Method not allowed'}, 405);
    if (req.headers.get('origin') && req.headers.get('origin') !== origin) return json({error: 'Origin not allowed'}, 403);
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({error: 'Sign in first.'}, 401);
    const {data: auth, error: authError} = await admin.auth.getUser(token);
    if (authError || !auth.user?.email || !auth.user.email_confirmed_at) return json({error: 'Sign in with your confirmed email address.'}, 401);
    const owner = auth.user.id, accountEmail = normalEmail(auth.user.email);
    if (Number(req.headers.get('content-length') || 0) > 12000000) return json({error: 'PDF too large.'}, 413);
    const reader = req.body?.getReader();
    let size = 0, raw = '';
    const decoder = new TextDecoder();
    if (reader) { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 12000000) { await reader.cancel(); return json({error: 'PDF too large.'}, 413); } raw += decoder.decode(value, {stream: true}); } }
    raw += decoder.decode();
    let body; try { body = JSON.parse(raw); } catch { return json({error: 'Invalid request.'}, 400); }
    if (!body || typeof body !== 'object') return json({error: 'Invalid request.'}, 400);
    if (body.action === 'status') {
      const rows = await sql`select email,provider,connection_status from action_plan_private.mailboxes where owner_id=${owner}`;
      const m = rows[0];
      const available = Object.fromEntries(['google','microsoft','icloud','yahoo','custom'].map(p => [p, configured(p as Provider)]));
      const connected = Boolean(m && normalEmail(m.email) === accountEmail && m.connection_status === 'connected' && isProvider(m.provider) && configured(m.provider));
      return json({configured: Object.values(available).some(Boolean), providers: available, connected, email: m?.email || null, accountEmail, provider: m?.provider || null, connectionStatus: !m ? 'disconnected' : normalEmail(m.email) !== accountEmail ? 'identity_mismatch' : !configured(m.provider) ? 'setup_required' : m.connection_status});
    }
    if (body.action === 'disconnect') {
      await sql.begin(async tx => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${owner},0))`;
        await tx`insert into action_plan_private.connection_guards(owner_id,generation) values(${owner},${crypto.randomUUID()}) on conflict(owner_id) do update set generation=excluded.generation`;
        await tx`delete from action_plan_private.oauth_states where owner_id=${owner}`;
        await tx`delete from action_plan_private.mailboxes where owner_id=${owner}`;
      });
      return json({disconnected: true});
    }
    if (body.action === 'connect') {
      const provider = body.provider || 'google'; // backward compatible with the existing UI
      if (!isProvider(provider)) throw new MailboxError('invalid_provider', 'Choose a supported email provider.');
      requireConfigured(provider);
      const state = url64(crypto.getRandomValues(new Uint8Array(32))), verifier = url64(crypto.getRandomValues(new Uint8Array(32)));
      await sql.begin(async tx => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${owner},0))`;
        const recent = await tx`select updated_at from action_plan_private.connection_guards where owner_id=${owner} and updated_at > now()-interval '15 seconds'`;
        if (recent.length) throw new MailboxError('rate_limited', 'Please wait a few seconds before trying another connection.', 429);
        await tx`insert into action_plan_private.connection_guards(owner_id,generation) values(${owner},${state}) on conflict(owner_id) do update set generation=excluded.generation,updated_at=now()`;
        await tx`delete from action_plan_private.oauth_states where owner_id=${owner} or expires_at<now()`;
        if (provider === 'google' || provider === 'microsoft') await tx`insert into action_plan_private.oauth_states(state,owner_id,verifier,expires_at,provider,expected_email) values(${state},${owner},${verifier},now()+interval '10 minutes',${provider},${accountEmail})`;
      });
      if (provider === 'google' || provider === 'microsoft') {
        const challenge = url64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
        const params = new URLSearchParams({client_id: (provider === 'google' ? googleId : microsoftId)!, redirect_uri: redirect, response_type: 'code', scope: provider === 'google' ? googleScope : microsoftScope, state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: accountEmail, prompt: 'consent', ...(provider === 'google' ? {access_type: 'offline'} : {response_mode: 'query'})});
        return json({url: (provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth?' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?') + params});
      }
      if (typeof body.appPassword !== 'string' || body.appPassword.length < 8 || body.appPassword.length > 256 || /[\r\n\0]/.test(body.appPassword)) throw new MailboxError('invalid_credential', 'Enter the app password generated by your email provider.');
      const checked = await relay({action: 'verify', provider, email: accountEmail, password: body.appPassword});
      if (!checked.verified) throw new MailboxError(checked.code === 'unsupported_domain' ? 'unsupported_domain' : 'reconnect_required', checked.code === 'unsupported_domain' ? 'Your company email server needs administrator setup. Choose Google or Microsoft if they host your company mailbox.' : 'Your provider rejected the connection. Check your app password and email provider.', 409);
      await sql.begin(async tx => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${owner},0))`;
        const guards = await tx`select generation from action_plan_private.connection_guards where owner_id=${owner}`;
        if (guards[0]?.generation !== state) throw new MailboxError('expired', 'Connection superseded. Try again.');
        const cipher = await seal(body.appPassword, owner, provider);
        await tx`insert into action_plan_private.mailboxes(owner_id,email,provider,token_cipher,connection_status) values(${owner},${accountEmail},${provider},${cipher},'connected') on conflict(owner_id) do update set email=excluded.email,provider=excluded.provider,token_cipher=excluded.token_cipher,connection_status='connected',updated_at=now()`;
      });
      return json({connected: true, email: accountEmail, provider});
    }
    if (body.action !== 'send') throw new MailboxError('invalid_action', 'Unknown mailbox action.');
    if (typeof body.planId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.planId) || !validPdf(body.pdf)) throw new MailboxError('invalid_plan', 'A finalised plan PDF is required.');
    const plans = await sql`select payload from public.action_plan_records where id=${body.planId} and owner_id=${owner} and status='finalised'`;
    if (plans.length !== 1) throw new MailboxError('invalid_plan', 'Finalise and save this plan first.', 409);
    const rows = await sql`select email,provider,token_cipher,connection_status from action_plan_private.mailboxes where owner_id=${owner}`;
    if (!rows.length) throw new MailboxError('reconnect_required', 'Connect your email first.', 409);
    const mailbox = rows[0], provider = mailbox.provider as Provider;
    if (!isProvider(provider)) throw new Error('Invalid provider');
    requireConfigured(provider);
    assertIdentity(accountEmail, mailbox.email);
    const payload = plans[0].payload;
    const v = payload.values;
    assertIdentity(mailbox.email, normalEmail(v.assessorEmail));
    const recipient = normalEmail(v.learnerEmail);
    if (!validEmail(recipient)) throw new MailboxError('invalid_recipient', 'The saved plan needs a valid learner email address.');
    if (provider === 'microsoft' && body.pdf.length > 2800000) throw new MailboxError('pdf_too_large', 'This PDF exceeds the Microsoft direct-send attachment limit. Download it and send it from your mailbox.', 413);
    let sendCipher = mailbox.token_cipher;
    let secret: string, accessToken: string | undefined;
    try {
      secret = await open(mailbox.token_cipher, owner, provider);
      if (provider === 'google' || provider === 'microsoft') {
        const tokens = await oauthToken(provider, {refresh_token: secret, grant_type: 'refresh_token'});
        accessToken = tokens.access_token;
        assertIdentity(accountEmail, await identity(provider, accessToken!));
        // Compare-and-swap avoids overwriting a newer connection or a disconnect while refreshing.
        const nextCipher = await seal(tokens.refresh_token || secret, owner, provider);
        const updated = await sql`update action_plan_private.mailboxes set token_cipher=${nextCipher},connection_status='connected',updated_at=now() where owner_id=${owner} and token_cipher=${mailbox.token_cipher} returning owner_id`;
        if (!updated.length) throw new MailboxError('connection_changed', 'Your mailbox connection changed. Refresh the connection status before sending.', 409);
        sendCipher = nextCipher;
      }
    } catch (error) {
      if (error instanceof MailboxError && ['reconnect_required','identity_mismatch'].includes(error.code)) await sql`update action_plan_private.mailboxes set connection_status='reconnect_required' where owner_id=${owner} and token_cipher=${mailbox.token_cipher}`;
      throw error;
    }
    const claimed = await sql`insert into public.action_plan_email_events(plan_id,owner_id,status,sender,recipient) values(${body.planId},${owner},'sending',${mailbox.email},${recipient}) on conflict(plan_id) do update set status='sending',detail=null,updated_at=now() where action_plan_email_events.status='failed' and action_plan_email_events.owner_id=${owner} returning plan_id`;
    if (!claimed.length) throw new MailboxError('already_sent', 'This email is already sent or awaiting confirmation. Check the record before sending again.', 409);
    const formatEmailDate = (value: unknown) => {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return '';
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
      return date.toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
    };
    const formatReferenceDate = (value: unknown) => {
      const match = String(value || '').match(/(?:^|-)(\d{2})-(\d{2})-(\d{4})(?:-|$)/);
      return match ? formatEmailDate(match[3] + '-' + match[2] + '-' + match[1]) : '';
    };
    const planDate = formatEmailDate(v.meetingDate) || formatReferenceDate(v.recordRef);
    const subjectLabel = v.planType === 'Initial Action Plan' ? 'Initial Plan' : 'Action Plan';
    const subject = 'Your ' + subjectLabel + (planDate ? ' – ' + planDate : '');
    const learnerFirstName = String(v.learnerName || '').trim().split(/\s+/)[0] || 'there';
    const summarizeEmailAction = (value: unknown) => {
      const paragraph = String(value || '').trim().split(/(?:\r?\n)\s*(?:\r?\n)+/).map(item => item.trim()).find(Boolean) || '';
      const normalized = paragraph.replace(/\s+/g, ' ').trim();
      if (normalized.length <= 240) return normalized;
      const sentence = normalized.match(/^(.+?[.!?])(?:\s|$)/);
      return sentence ? sentence[1].trim() : normalized;
    };
    const actionCount = Number.isInteger(Number(payload.actionCount)) && Number(payload.actionCount) > 0 ? Number(payload.actionCount) : 0;
    const actions: string[] = [];
    for (let index = 0; index < actionCount; index++) {
      const task = summarizeEmailAction(v['action' + index + 'Task']);
      if (!task) continue;
      const targetDate = formatEmailDate(v['action' + index + 'Target']);
      actions.push('Action ' + (actions.length + 1) + ': ' + task + (targetDate ? '\r\nTarget date: ' + targetDate : ''));
    }
    const reviewDate = formatEmailDate(v.reviewDate);
    const text = [
      'Hi ' + learnerFirstName + ',',
      '',
      "Thanks for taking the time to catch up with me. I've attached a copy of the Action Plan we agreed together.",
      '',
      'Your agreed actions',
      '',
      actions.join('\r\n\r\n'),
      ...(reviewDate ? ['', 'Next review: ' + reviewDate] : []),
      '',
      'Full details of your agreed actions are included in the attached Action Plan.',
      '',
      'Action Plan reference: ' + String(v.recordRef || ''),
      '',
      "Please have a read through and reply to this email to confirm you've received your Action Plan. If you have any questions or anything needs clarifying, just let me know.",
      '',
      'Kind regards,',
      String(v.assessorName || '').trim()
    ].join('\r\n');
    const messageId = '<' + body.planId + '@action-plans.pt-academy.invalid>';
    let outcome: {status: string; id?: string; reconnect?: boolean} = {status: 'unknown'};
    try {
      if (provider === 'google' || provider === 'microsoft') {
        const boundary = 'cava_' + crypto.randomUUID();
        const mime = ['From: ' + mailbox.email, 'To: ' + recipient, 'Subject: =?UTF-8?B?' + b64(new TextEncoder().encode(subject)) + '?=', 'Message-ID: ' + messageId, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"', '', '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(new TextEncoder().encode(text)).match(/.{1,76}/g)!.join('\r\n'), '--' + boundary, 'Content-Type: application/pdf; name="Action-Plan.pdf"', 'Content-Disposition: attachment; filename="Action-Plan.pdf"', 'Content-Transfer-Encoding: base64', '', body.pdf.match(/.{1,76}/g).join('\r\n'), '--' + boundary + '--'].join('\r\n');
        const response = await request(provider === 'google' ? 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send' : 'https://graph.microsoft.com/v1.0/me/sendMail', {method: 'POST', headers: {Authorization: 'Bearer ' + accessToken, 'Content-Type': provider === 'google' ? 'application/json' : 'text/plain'}, body: provider === 'google' ? JSON.stringify({raw: url64(new TextEncoder().encode(mime))}) : b64(new TextEncoder().encode(mime))});
        if (response.ok) outcome = {status: 'sent', id: provider === 'google' ? (await response.json()).id : messageId};
        else outcome = {status: response.status >= 500 || response.status === 408 ? 'unknown' : 'failed', reconnect: [401,403].includes(response.status)};
      } else {
        const sent = await relay({action: 'send', provider, email: mailbox.email, password: secret!, recipient, subject, text, pdf: body.pdf, messageId});
        outcome = {status: sent.sent ? 'sent' : sent.definitivelyRejected ? 'failed' : 'unknown', id: sent.messageId, reconnect: sent.code === 'auth_failed'};
      }
    } catch { /* An uncertain send must never become an automatically retryable failure. */ }
    const detail = outcome.status === 'sent' ? 'Accepted by your email provider. Learner receipt has not been confirmed.' : outcome.status === 'failed' ? 'Your provider rejected this email. Check the connection and learner address before trying again.' : 'Sending could not be confirmed. Check with your email provider before retrying; no automatic resend will occur.';
    await sql`update public.action_plan_email_events set status=${outcome.status},provider_message_id=${outcome.id || null},sent_at=${outcome.status === 'sent' ? new Date() : null},detail=${detail},updated_at=now() where plan_id=${body.planId} and owner_id=${owner}`;
    if (outcome.reconnect) await sql`update action_plan_private.mailboxes set connection_status='reconnect_required' where owner_id=${owner} and token_cipher=${sendCipher}`;
    return outcome.status === 'sent' ? json({sent: true}) : json({error: detail, code: outcome.reconnect ? 'reconnect_required' : 'send_not_confirmed'}, 502);
  } catch (error) {
    // Never return raw database, credential, SMTP or provider responses to the browser or logs.
    return error instanceof MailboxError ? json({error: error.message, code: error.code}, error.status) : json({error: 'The mailbox request could not be completed. Your saved plan is safe. Please try again or contact support.', code: 'mailbox_unavailable'}, 503);
  }
}
Deno.serve(handler);
