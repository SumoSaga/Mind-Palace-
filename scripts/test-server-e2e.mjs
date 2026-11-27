// Starts the real server in production mode with sign-in on, in a temporary
// data folder, and checks what a signed-out and a signed-in visitor can reach.
// Needs the app to have been built (npm run build). Run with: node scripts/test-server-e2e.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { COOKIE, makeSession } from '../server/auth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mind-palace-e2e-'));
const PORT = 18765;
const SECRET = 'e2e-secret-'.padEnd(40, 'x');
const base = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server/sync-server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    ALLOWED_EMAILS: 'owner@example.com',
    GOOGLE_CLIENT_ID: 'e2e-client',
    SESSION_SECRET: SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

const cookieFor = (email) => `${COOKIE}=${makeSession({ email, name: 'Test' }, SECRET)}`;
const owner = cookieFor('owner@example.com');
const stranger = cookieFor('stranger@example.com');

/** Tries to open a workspace connection; resolves to 'open' or the refusal status. */
const connect = (headers) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sync/default`, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });

try {
  // Wait for the server to come up.
  for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(log, /sign-in on for 1 account/, `server did not start:\n${log}`);

  // The app itself loads for anyone (it shows the sign-in screen).
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<div id="root">/);
  assert.equal((await fetch(`${base}/some/deep/link`)).status, 200, 'unknown paths serve the app');
  const outside = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.doesNotMatch(await outside.text(), /"mind-palace"/, 'files outside the app folder are not served');

  // Signed out.
  assert.deepEqual(await (await fetch(`${base}/auth/me`)).json(), { required: true, clientId: 'e2e-client', user: null });
  assert.equal((await fetch(`${base}/files/00000000-0000-0000-0000-000000000000`)).status, 401);
  assert.equal((await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: 'x' })).status, 401);
  assert.equal(await connect({}), 401);
  assert.equal((await fetch(`${base}/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'garbage' }) })).status, 401);

  // A valid session for an address that is not on the allowed list.
  assert.equal((await (await fetch(`${base}/auth/me`, { headers: { Cookie: stranger } })).json()).user, null);
  assert.equal(await connect({ Cookie: stranger }), 401);

  // Signed in as the allowed owner.
  assert.deepEqual((await (await fetch(`${base}/auth/me`, { headers: { Cookie: owner } })).json()).user, { email: 'owner@example.com', name: 'Test' });
  assert.equal(await connect({ Cookie: owner }), 'open');
  const upload = await fetch(`${base}/files`, { method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/pdf' }, body: '%PDF-test' });
  assert.equal(upload.status, 201);
  const { url } = await upload.json();
  assert.equal(await (await fetch(`${base}${url}`, { headers: { Cookie: owner } })).text(), '%PDF-test');
  assert.equal((await fetch(`${base}${url}`)).status, 401, 'files need a session too');

  // Requests from another site are refused even with the owner's cookie.
  assert.equal(await connect({ Cookie: owner, Origin: 'https://evil.example' }), 403);
  assert.equal((await fetch(`${base}/files`, { method: 'POST', headers: { Cookie: owner, Origin: 'https://evil.example', 'Content-Type': 'application/pdf' }, body: 'x' })).status, 403);

  // Bad space names are refused.
  const bad = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sync/..%2Fsecrets`, { headers: { Cookie: owner } });
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode));
    ws.on('open', () => resolve('open'));
    ws.on('error', () => resolve('error'));
  });
  assert.equal(bad, 400);

  // Signing out clears the cookie.
  const out = await fetch(`${base}/auth/signout`, { method: 'POST', headers: { Cookie: owner } });
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);

  console.log('server end-to-end: all checks passed');
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
