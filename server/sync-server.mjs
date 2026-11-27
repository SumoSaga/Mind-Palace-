// The Mind Palace server. One process does four jobs:
//   - relays workspace changes between browsers and saves them (rooms.mjs)
//   - stores and serves uploaded files such as PDFs and videos (files.mjs)
//   - signs people in with Google and checks they are allowed in (auth.mjs)
//   - serves the built app itself, when there is one (static.mjs)
//
// While developing, `npm run dev` runs this alongside Vite, which serves the
// app and forwards /sync, /files and /auth here. In production, `npm start`
// runs this alone.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { configProblems, cookieHeader, makeSession, readConfig, readSession, verifyGoogleToken } from './auth.mjs';
import { AiError, aiAvailable, rankLayouts } from './ai.mjs';
import { handleFiles } from './files.mjs';
import { createPairing, isLocalRequest, lanAddresses, remoteAddressOf } from './pairing.mjs';
import { createRooms, validRoomName } from './rooms.mjs';
import { handleStatic } from './static.mjs';

// While developing (`--dev`), the port is fixed at 1234, where Vite forwards to;
// PORT then belongs to Vite. In production the host chooses the port with PORT.
const DEV = process.argv.includes('--dev');
const PORT = DEV ? 1234 : Number(process.env.PORT ?? 1234);
// Saved workspaces and uploaded files live here. DATA_DIR lets a host point it at a persistent disk.
const DATA = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const auth = readConfig();
const problems = configProblems(auth);
if (problems.length) {
  console.error('Sign-in is switched on but not fully set up:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const rooms = createRooms(path.join(DATA, 'spaces'));

// Without Google sign-in (the home setup), devices are let in by pairing instead.
const pairing = createPairing(DATA);

/**
 * Who is making this request, or null if they may not come in.
 * With Google sign-in on: a signed-in, allowed account.
 * Without it: this computer itself, or a device that has been paired.
 */
function userOf(req) {
  if (auth.required) return readSession(req.headers.cookie, auth);
  return isLocalRequest(req, DEV) || pairing.isPaired(req.headers.cookie) ? { email: 'local', name: 'Local' } : null;
}

/** True unless the request comes from a page on some other site. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 16 * 1024) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error('Request too large');
  }
  return JSON.parse(text || '{}');
}

async function handleAuth(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/auth/me') {
    return json(res, 200, {
      required: auth.required,
      clientId: auth.clientId,
      user: auth.required ? userOf(req) : null,
      // With sign-in off, a device must be this computer or have been paired.
      pairing: auth.required ? null : { paired: !!userOf(req) },
    });
  }
  if (req.method === 'POST' && pathname === '/auth/google') {
    if (!auth.required) return json(res, 400, { error: 'Sign-in is not switched on.' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed from another site.' });
    let user;
    try {
      const { credential } = await readJson(req);
      user = await verifyGoogleToken(credential, { clientId: auth.clientId });
    } catch (err) {
      console.error('[auth] sign-in rejected:', err.message);
      return json(res, 401, { error: 'Google sign-in could not be verified. Try again.' });
    }
    if (!auth.allowed.includes(user.email)) {
      return json(res, 403, { error: `${user.email} has not been given access to this Mind Palace.` });
    }
    return json(res, 200, { user }, { 'Set-Cookie': cookieHeader(makeSession(user, auth.secret), { secure: isSecure(req) }) });
  }
  if (req.method === 'POST' && pathname === '/auth/signout') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed from another site.' });
    return json(res, 200, {}, { 'Set-Cookie': cookieHeader('', { secure: isSecure(req), clear: true }) });
  }
  return json(res, 404, { error: 'Not found' });
}

/** Connecting a new device with a code or QR code; see pairing.mjs. */
async function handlePair(req, res, pathname) {
  if (auth.required) return json(res, 404, { error: 'Not found' });
  // A connected device asks for the code to show.
  if (req.method === 'GET' && pathname === '/pair/code') {
    if (!userOf(req)) return json(res, 401, { error: 'Connect this device first.' });
    return json(res, 200, { ...pairing.currentCode(), addresses: lanAddresses() });
  }
  // A new device hands in a code.
  if (req.method === 'POST' && pathname === '/pair') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed from another site.' });
    if (!pairing.allowAttempt(remoteAddressOf(req))) return json(res, 429, { error: 'Too many tries. Wait a minute and try again.' });
    let code;
    try {
      ({ code } = await readJson(req, 1024));
    } catch {
      return json(res, 400, { error: 'That did not look like a code.' });
    }
    if (!pairing.redeem(code)) {
      return json(res, 401, { error: 'That code is not right, or it has expired. Check the code on your connected device.' });
    }
    return json(res, 200, { paired: true }, { 'Set-Cookie': pairing.cookie(pairing.deviceToken()) });
  }
  return json(res, 404, { error: 'Not found' });
}

/** Optional Claude features; see ai.mjs. */
async function handleAi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/ai/status') return json(res, 200, { available: aiAvailable() });
  if (req.method === 'POST' && pathname === '/ai/rank') {
    if (!userOf(req)) return json(res, 401, { error: 'Sign in first.' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Not allowed from another site.' });
    try {
      return json(res, 200, { ranking: await rankLayouts(await readJson(req, 64 * 1024)) });
    } catch (err) {
      if (err instanceof AiError) return json(res, err.status, { error: err.message });
      console.error('[ai] ranking failed', err);
      return json(res, 500, { error: 'Something went wrong asking Claude.' });
    }
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  let work;
  if (pathname.startsWith('/auth/')) work = handleAuth(req, res, pathname);
  else if (pathname === '/pair' || pathname.startsWith('/pair/')) work = handlePair(req, res, pathname);
  else if (pathname.startsWith('/ai/')) work = handleAi(req, res, pathname);
  else if (pathname === '/files' || pathname.startsWith('/files/')) {
    if (!userOf(req)) work = Promise.resolve(json(res, 401, { error: 'Sign in first.' }));
    else if (req.method === 'POST' && !sameOrigin(req)) work = Promise.resolve(json(res, 403, { error: 'Not allowed from another site.' }));
    else work = handleFiles(req, res);
  } else work = handleStatic(req, res);
  work.catch((err) => {
    console.error('[server] error', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

// Workspace connections. They are accepted only from this app's own pages and,
// when sign-in is on, only with a valid session.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const refuse = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  // Reached as /sync/<space> directly, or as /<space> through the development proxy.
  let name = 'default';
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    name = pathname.replace(/^\/sync(?=\/|$)/, '').replace(/^\//, '') || 'default';
  } catch {
    return refuse('400 Bad Request');
  }
  if (!validRoomName(name)) return refuse('400 Bad Request');
  // Always checked: otherwise any website open on this computer could connect
  // to the workspace through the browser.
  if (!sameOrigin(req)) return refuse('403 Forbidden');
  if (!userOf(req)) return refuse('401 Unauthorized');
  wss.handleUpgrade(req, socket, head, (ws) => {
    try {
      rooms.connect(ws, name);
    } catch (err) {
      console.error('[sync] could not open space', err);
      ws.close(1011, 'Could not open this space');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[server] listening on port ${PORT}; ${auth.required ? `Google sign-in on for ${auth.allowed.length} account(s)` : 'other devices connect by pairing code'}`,
  );
});

// Save everything before stopping, so a restart or redeploy loses nothing.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void rooms.saveAll().finally(() => process.exit(0));
  });
}
