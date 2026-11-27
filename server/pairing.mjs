// Device pairing, for when Mind Palace runs at home without Google sign-in.
//
// The computer running the server is always allowed in. Any other device must
// be paired once: someone on an already-connected device opens "Connect a
// device", and the new device either scans the QR code shown there or types
// the 6-digit code. The server then gives that device a signed cookie, and it
// is remembered from then on.
//
// Codes last ten minutes and can be used by several devices in that time. A
// code is replaced after too many wrong guesses.
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEVICE_COOKIE = 'mp_device';
const CODE_MINUTES = 10;
const MAX_WRONG_GUESSES = 10;
const ATTEMPTS_PER_MINUTE = 8;
const REMEMBER_DAYS = 365;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = (address) => LOOPBACK.has(String(address ?? '').trim());

/**
 * True when the request comes from the computer running the server.
 *
 * While developing, every request arrives through Vite on this same computer,
 * so the connection alone says nothing. Vite states the real origin in an
 * `x-mp-remote` header (see vite.config.ts), which it always overwrites. In
 * that mode a request with no such header is NOT treated as local: if the
 * header were ever missing, devices would have to pair rather than be let in.
 *
 * In production the server is reached directly, so a local connection that
 * was not forwarded by anything is this computer.
 *
 * @param {boolean} behindDevProxy true when started with --dev
 */
export function isLocalRequest(req, behindDevProxy) {
  if (!isLoopback(req.socket?.remoteAddress)) return false;
  const stated = req.headers?.['x-mp-remote'];
  if (behindDevProxy) return stated !== undefined && isLoopback(stated);
  return stated === undefined && !req.headers?.['x-forwarded-for'];
}

/** The address a request really came from, for limiting repeated code guesses. */
export function remoteAddressOf(req) {
  return String(req.headers?.['x-mp-remote'] ?? req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown');
}

/** This computer's addresses on the local network, for other devices to connect to. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

export function createPairing(dataDir) {
  // The key that signs device cookies. Kept on disk so paired devices stay
  // paired across restarts; deleting the file un-pairs every device.
  mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'pairing.key');
  if (!existsSync(keyFile)) writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = readFileSync(keyFile, 'utf8').trim();
  const sign = (text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

  let current = null; // { code, expires, wrong }
  const attempts = new Map(); // address -> recent attempt times

  /** The code to show on a connected device; a fresh one if the last has expired or been guessed at too much. */
  function currentCode(now = Date.now()) {
    if (!current || current.expires <= now || current.wrong >= MAX_WRONG_GUESSES) {
      current = {
        code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
        expires: now + CODE_MINUTES * 60 * 1000,
        wrong: 0,
      };
    }
    return { code: current.code, expiresAt: current.expires };
  }

  /** Whether this address may try another code right now. Records the attempt. */
  function allowAttempt(address, now = Date.now()) {
    const recent = (attempts.get(address) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= ATTEMPTS_PER_MINUTE) {
      attempts.set(address, recent);
      return false;
    }
    recent.push(now);
    attempts.set(address, recent);
    return true;
  }

  /** Checks a code a new device entered. */
  function redeem(given, now = Date.now()) {
    if (!current || current.expires <= now || current.wrong >= MAX_WRONG_GUESSES) return false;
    const a = Buffer.from(String(given ?? '').replace(/\D/g, '').padStart(6, '0').slice(0, 16));
    const b = Buffer.from(current.code);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    current.wrong++;
    return false;
  }

  /** The cookie value that marks a device as paired. */
  function deviceToken(now = Date.now()) {
    const body = Buffer.from(JSON.stringify({ id: crypto.randomUUID(), paired: now })).toString('base64url');
    return `${body}.${sign(body)}`;
  }

  function isPaired(cookieHeader) {
    const value = String(cookieHeader ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${DEVICE_COOKIE}=`))
      ?.slice(DEVICE_COOKIE.length + 1);
    if (!value) return false;
    const [body, mac] = value.split('.');
    if (!body || !mac) return false;
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(mac);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  const cookie = (token) =>
    [`${DEVICE_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${REMEMBER_DAYS * 24 * 60 * 60}`].join('; ');

  return { currentCode, allowAttempt, redeem, deviceToken, isPaired, cookie };
}
