// Checks device pairing: the code logic on its own, then the real server
// refusing an unpaired device and admitting it once it has the code.
// Run with: node scripts/test-pairing.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createPairing, DEVICE_COOKIE, isLocalRequest } from '../server/pairing.mjs';

const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), name));

// --- which requests count as this computer --------------------------------------

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
// Production (reached directly).
assert.equal(isLocalRequest(req('127.0.0.1'), false), true);
assert.equal(isLocalRequest(req('::1'), false), true);
assert.equal(isLocalRequest(req('192.168.1.20'), false), false);
assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.20' }), false), false, 'forwarded by a proxy');
assert.equal(isLocalRequest(req('127.0.0.1', { 'x-mp-remote': '127.0.0.1' }), false), false, 'header is not trusted outside dev');
// Development (everything arrives through Vite on this computer).
assert.equal(isLocalRequest(req('127.0.0.1', { 'x-mp-remote': '::1' }), true), true, 'the PC browser');
assert.equal(isLocalRequest(req('127.0.0.1', { 'x-mp-remote': '192.168.1.20' }), true), false, 'a phone on the Wi-Fi');
assert.equal(isLocalRequest(req('127.0.0.1'), true), false, 'no header in dev: not assumed local');
assert.equal(isLocalRequest(req('192.168.1.20', { 'x-mp-remote': '127.0.0.1' }), true), false, 'straight to the server from elsewhere');

// --- codes and remembered devices -------------------------------------------------

const dir = tmp('mind-palace-pair-');
try {
  const p = createPairing(dir);
  const t0 = 1_000_000;
  const { code, expiresAt } = p.currentCode(t0);
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, t0 + 10 * 60 * 1000);
  assert.equal(p.currentCode(t0 + 60_000).code, code, 'the same code within its ten minutes');
  assert.equal(p.redeem('000000' === code ? '111111' : '000000', t0), false);
  assert.equal(p.redeem(code, t0), true);
  assert.equal(p.redeem(`${code.slice(0, 3)} ${code.slice(3)}`, t0), true, 'spaces are ignored');
  assert.equal(p.redeem(code, t0 + 5 * 60_000), true, 'several devices can use one code');
  assert.equal(p.redeem(code, expiresAt + 1), false, 'expired');
  assert.notEqual(p.currentCode(expiresAt + 1).expiresAt, expiresAt, 'a new code after expiry');

  // Ten wrong guesses retire a code, even for someone who then guesses right.
  const q = createPairing(tmp('mind-palace-pair-'));
  const second = q.currentCode(t0).code;
  const wrong = second === '999999' ? '888888' : '999999';
  for (let i = 0; i < 10; i++) assert.equal(q.redeem(wrong, t0), false);
  assert.equal(q.redeem(second, t0), false, 'retired after too many wrong guesses');
  assert.notEqual(q.currentCode(t0).code === second && q.redeem(second, t0), true);

  // Guess limiting per address.
  for (let i = 0; i < 8; i++) assert.equal(p.allowAttempt('10.0.0.5', t0), true);
  assert.equal(p.allowAttempt('10.0.0.5', t0), false);
  assert.equal(p.allowAttempt('10.0.0.6', t0), true, 'other addresses are unaffected');
  assert.equal(p.allowAttempt('10.0.0.5', t0 + 61_000), true, 'allowed again after a minute');

  // Device cookies: genuine ones are recognised, including after a restart; forged ones are not.
  const token = p.deviceToken();
  assert.equal(p.isPaired(`a=b; ${DEVICE_COOKIE}=${token}`), true);
  assert.equal(createPairing(dir).isPaired(`${DEVICE_COOKIE}=${token}`), true, 'still paired after a restart');
  assert.equal(q.isPaired(`${DEVICE_COOKIE}=${token}`), false, 'signed by a different installation');
  assert.equal(p.isPaired(`${DEVICE_COOKIE}=${token.slice(0, -2)}xx`), false);
  assert.equal(p.isPaired(''), false);
  assert.equal(p.isPaired(undefined), false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// --- the real server, with Google sign-in off --------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = tmp('mind-palace-pair-e2e-');
const PORT = 18766;
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir };
delete env.ALLOWED_EMAILS;
delete env.AUTH;
const server = spawn(process.execPath, ['server/sync-server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

// A request that looks like it came from another device on the network.
const PHONE = { 'x-forwarded-for': '192.168.1.50' };
const connect = (headers) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sync/default`, { headers });
    ws.on('open', () => (ws.close(), resolve('open')));
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
const post = (body, headers = {}) =>
  fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

try {
  for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(log, /pairing code/, `server did not start:\n${log}`);

  // This computer is in without pairing, and can see the code.
  assert.deepEqual((await (await fetch(`${base}/auth/me`)).json()).pairing, { paired: true });
  assert.equal(await connect({}), 'open');
  const shown = await (await fetch(`${base}/pair/code`)).json();
  assert.match(shown.code, /^\d{6}$/);
  assert.ok(Array.isArray(shown.addresses));

  // Another device is not in, and cannot see the code.
  assert.deepEqual((await (await fetch(`${base}/auth/me`, { headers: PHONE })).json()).pairing, { paired: false });
  assert.equal(await connect(PHONE), 401);
  assert.equal((await fetch(`${base}/pair/code`, { headers: PHONE })).status, 401);
  assert.equal((await fetch(`${base}/files/00000000-0000-0000-0000-000000000000`, { headers: PHONE })).status, 401);

  // A wrong code is refused; the right one pairs the device.
  const wrong = shown.code === '123456' ? '654321' : '123456';
  assert.equal((await post({ code: wrong }, PHONE)).status, 401);
  assert.equal((await post({ code: shown.code }, { ...PHONE, Origin: 'https://evil.example' })).status, 403, 'not from another site');
  const paired = await post({ code: shown.code }, PHONE);
  assert.equal(paired.status, 200);
  const cookie = (paired.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(cookie, new RegExp(`^${DEVICE_COOKIE}=`));
  assert.match(paired.headers.get('set-cookie'), /HttpOnly/);

  // With its cookie, the device is in.
  const asPhone = { ...PHONE, Cookie: cookie };
  assert.deepEqual((await (await fetch(`${base}/auth/me`, { headers: asPhone })).json()).pairing, { paired: true });
  assert.equal(await connect(asPhone), 'open');
  assert.equal((await fetch(`${base}/pair/code`, { headers: asPhone })).status, 200, 'a paired device can show the code too');
  assert.equal(await connect({ ...PHONE, Cookie: `${DEVICE_COOKIE}=forged.value` }), 401);

  // A website open on this computer cannot use the browser to reach the workspace.
  assert.equal(await connect({ Origin: 'https://evil.example' }), 403);

  // Repeated guessing from one address is slowed down.
  const guesser = { 'x-forwarded-for': '192.168.1.77' };
  let limited = false;
  for (let i = 0; i < 9; i++) limited = (await post({ code: wrong }, guesser)).status === 429 || limited;
  assert.equal(limited, true);

  console.log('pairing: all checks passed');
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
