export const providers = ['google', 'microsoft', 'icloud', 'yahoo', 'custom'] as const;
export type Provider = typeof providers[number];
export const isProvider = (value: unknown): value is Provider => providers.includes(value as Provider);
export const normalEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(value);
}
export const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
export const un64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const url64 = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export class MailboxError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function credentialKey(raw: string) {
  const bytes = un64(raw);
  if (bytes.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', bytes, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
}
export async function encrypt(secret: string, key: CryptoKey, owner: string, provider: Provider) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(owner + ':' + provider);
  const body = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData}, key, new TextEncoder().encode(secret));
  return 'v2.' + b64(iv) + '.' + b64(new Uint8Array(body));
}
export async function decrypt(cipher: string, key: CryptoKey, owner: string, provider: Provider) {
  const parts = cipher.split('.');
  const modern = parts[0] === 'v2';
  if ((!modern && (provider !== 'google' || parts.length !== 2)) || (modern && parts.length !== 3)) throw new Error('Invalid ciphertext');
  const [iv, body] = modern ? parts.slice(1) : parts;
  const additionalData = modern ? new TextEncoder().encode(owner + ':' + provider) : undefined;
  return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: un64(iv), additionalData}, key, un64(body)));
}
export function assertIdentity(expected: string, actual: string) {
  if (!validEmail(actual) || normalEmail(actual) !== normalEmail(expected)) {
    throw new MailboxError('identity_mismatch', 'Connect the mailbox matching your confirmed Learner Hub email address.');
  }
}
export function validPdf(value: unknown): value is string {
  return typeof value === 'string' && value.length < 11000000 && value.length % 4 === 0 && /^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value);
}
