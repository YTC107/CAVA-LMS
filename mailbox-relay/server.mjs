import http from 'node:http';
import crypto from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import nodemailer from 'nodemailer';
import {pathToFileURL} from 'node:url';

const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;
export const validEmail = v => typeof v === 'string' && v.length <= 254 && emailPattern.test(v);
export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
}
export function providerConfig(provider, email, custom = {}) {
  if (!validEmail(email) || email !== email.toLowerCase()) throw new Error('invalid_email');
  const domain = email.split('@')[1];
  if (provider === 'icloud' && ['icloud.com','me.com','mac.com'].includes(domain)) return {host: 'smtp.mail.me.com', port: 587};
  if (provider === 'yahoo' && ['yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com'].includes(domain)) return {host: 'smtp.mail.yahoo.com', port: 465};
  // Custom-domain hosting (including iCloud custom domains) is approved by the administrator, never by browser input.
  const config = custom[domain];
  if (provider !== 'custom' || !config || typeof config.host !== 'string' || !/^[a-z0-9.-]+$/.test(config.host) || isIP(config.host) || ![465,587].includes(config.port)) throw new Error('unsupported_domain');
  return {host: config.host, port: config.port};
}
export function authenticate(headers, raw, secret, seen, now = Date.now()) {
  const timestamp = headers['x-mailbox-time'], nonce = headers['x-mailbox-nonce'], signature = headers['x-mailbox-signature'];
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60000 || typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce) || typeof signature !== 'string') return false;
  for (const [key, time] of seen) if (time < now - 120000) seen.delete(key);
  if (seen.has(nonce) || seen.size > 10000) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + nonce + '.' + raw).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) return false;
  seen.set(nonce, now);
  return true;
}
export async function deliver(body, custom, transportFactory = nodemailer.createTransport, resolve = lookup) {
  let config;
  try { config = providerConfig(body.provider, body.email, custom); } catch { return {verified: false, sent: false, definitivelyRejected: true, code: 'unsupported_domain'}; }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256 || /[\r\n\0]/.test(body.password) || !['verify','send'].includes(body.action)) return {sent: false, definitivelyRejected: true, code: 'invalid_request'};
  // Resolve only administrator-approved hostnames, reject private addresses and pin the TLS socket to the checked IP.
  const addresses = await resolve(config.host, {all: true, family: 4});
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new Error('Unsafe host');
  const transport = transportFactory({host: addresses[0].address, port: config.port, secure: config.port === 465, requireTLS: true,
    tls: {servername: config.host, rejectUnauthorized: true, minVersion: 'TLSv1.2'},
    auth: {user: body.email, pass: body.password}, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true});
  try {
    if (body.action === 'verify') { await transport.verify(); return {verified: true}; }
    if (!validEmail(body.recipient) || typeof body.pdf !== 'string' || body.pdf.length > 11000000 || body.pdf.length % 4 !== 0 || !/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(body.pdf) || typeof body.text !== 'string' || body.text.length > 50000 || typeof body.subject !== 'string' || body.subject.length > 500 || /[\r\n]/.test(body.subject) || !/^<[a-f0-9-]{36}@action-plans\.pt-academy\.invalid>$/.test(body.messageId)) return {sent: false, definitivelyRejected: true, code: 'invalid_request'};
    const info = await transport.sendMail({from: body.email, to: body.recipient, envelope: {from: body.email, to: [body.recipient]}, subject: body.subject, text: body.text, messageId: body.messageId,
      attachments: [{filename: 'Action-Plan.pdf', content: Buffer.from(body.pdf, 'base64'), contentType: 'application/pdf'}], disableFileAccess: true, disableUrlAccess: true});
    return {sent: info.accepted?.length === 1, messageId: info.messageId};
  } catch (error) {
    // An explicit SMTP rejection is retryable. A timeout/socket loss after DATA could mean it was accepted.
    const definitivelyRejected = error.code === 'EAUTH' || (Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode < 600);
    return {verified: false, sent: false, definitivelyRejected, code: error.code === 'EAUTH' ? 'auth_failed' : 'send_failed'};
  } finally { transport.close(); }
}
export function createServer({secret, custom = {}, deliverFn = deliver}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('A relay signing secret of at least 32 characters is required');
  const seen = new Map();
  let active = 0;
  const server = http.createServer(async (req,res) => {
    const reply = (status, body) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return reply(200,{ok:true});
    if (req.method !== 'POST' || req.url !== '/mailbox') return reply(404,{error:'Not found'});
    if (active >= 20) return reply(503,{error:'Busy'});
    active++;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 12000000) { reply(413,{error:'Request too large'}); req.destroy(); return; } chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!authenticate(req.headers, raw, secret, seen)) return reply(401,{error:'Unauthorized'});
      let body; try { body = JSON.parse(raw); } catch { return reply(400,{error:'Invalid request'}); }
      if (!body || typeof body !== 'object') return reply(400,{error:'Invalid request'});
      return reply(200,await deliverFn(body,custom));
    } catch { return reply(200,{sent:false,verified:false,definitivelyRejected:false,code:'service_unavailable'}); }
    finally { active--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const custom = JSON.parse(process.env.ACTION_PLAN_SMTP_DOMAINS || '{}');
  createServer({secret: process.env.ACTION_PLAN_SMTP_RELAY_KEY, custom}).listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
