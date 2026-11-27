// Sign-in: the browser signs in with Google and sends the resulting ID token
// here. The server checks the token really came from Google for this app,
// checks the account is on the allowed list, and hands back a signed session
// cookie. Everything else (the workspace connection, files) requires that cookie.
//
// Settings (environment variables):
//   ALLOWED_EMAILS   comma-separated Google addresses that may use this installation
//   GOOGLE_CLIENT_ID the OAuth client ID (the same one the app uses for Google Docs)
//   SESSION_SECRET   a long random string used to sign session cookies
//   AUTH             "on" or "off"; defaults to on when ALLOWED_EMAILS is set
import crypto from 'node:crypto';

export const COOKIE = 'mp_session';
const SESSION_DAYS = 30;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function readConfig(env = process.env) {
  const allowed = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    required: env.AUTH ? env.AUTH === 'on' : allowed.length > 0,
    allowed,
    clientId: (env.GOOGLE_CLIENT_ID ?? '').trim(),
    secret: env.SESSION_SECRET ?? '',
  };
}

/** What is missing for sign-in to work, in words. Empty when the settings are complete. */
export function configProblems(config) {
  if (!config.required) return [];
  const problems = [];
  if (!config.allowed.length) problems.push('ALLOWED_EMAILS is empty, so nobody could sign in.');
  if (!config.clientId) problems.push('GOOGLE_CLIENT_ID is not set.');
  if (config.secret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters.');
  return problems;
}

let certCache = { keys: null, expires: 0 };

async function googleKeys() {
  if (certCache.keys && certCache.expires > Date.now()) return certCache.keys;
  const response = await fetch(GOOGLE_CERTS);
  if (!response.ok) throw new Error('Could not fetch Google signing keys');
  certCache = { keys: (await response.json()).keys, expires: Date.now() + 60 * 60 * 1000 };
  return certCache.keys;
}

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Checks a Google ID token and returns who it is for. Throws if it is not a
 * genuine, unexpired token issued by Google for this app.
 * `keys` and `now` exist so tests can supply their own.
 */
export async function verifyGoogleToken(token, { clientId, keys, now = Date.now() }) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [head, body, signature] = parts;
  const header = decodePart(head);
  const claims = decodePart(body);
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  const jwk = (keys ?? (await googleKeys())).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${head}.${body}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw new Error('Bad token signature');
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('Token was not issued by Google');
  if (claims.aud !== clientId) throw new Error('Token was issued for a different app');
  if (!(Number(claims.exp) * 1000 > now)) throw new Error('Token has expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Email is not verified');
  if (!claims.email) throw new Error('Token has no email');
  return { email: String(claims.email).toLowerCase(), name: String(claims.name ?? claims.email) };
}

const sign = (text, secret) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

/** A session cookie value: who is signed in and until when, signed so it cannot be altered. */
export function makeSession(user, secret, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({ email: user.email, name: user.name, exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000 }),
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** The signed-in user from a request's Cookie header, or null. */
export function readSession(cookieHeader, config, now = Date.now()) {
  const value = String(cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [body, mac] = value.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, config.secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const session = decodePart(body);
    if (!(session.exp > now)) return null;
    // Removing an address from the allowed list ends its sessions too.
    if (!config.allowed.includes(session.email)) return null;
    return { email: session.email, name: session.name };
  } catch {
    return null;
  }
}

export function cookieHeader(value, { secure, clear = false }) {
  return [
    `${COOKIE}=${clear ? '' : value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : SESSION_DAYS * 24 * 60 * 60}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
