// Checks the server's sign-in logic and that spaces are saved and reloaded.
// Run with: node scripts/test-server.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { configProblems, makeSession, readConfig, readSession, verifyGoogleToken, COOKIE } from '../server/auth.mjs';
import { createRooms, validRoomName } from '../server/rooms.mjs';

// --- sign-in settings ---------------------------------------------------------

assert.equal(readConfig({}).required, false);
assert.deepEqual(configProblems(readConfig({})), []);
const partial = readConfig({ ALLOWED_EMAILS: ' Me@Example.com , you@example.com ' });
assert.equal(partial.required, true);
assert.deepEqual(partial.allowed, ['me@example.com', 'you@example.com']);
assert.equal(configProblems(partial).length, 2); // no client id, no secret
assert.equal(readConfig({ ALLOWED_EMAILS: 'a@b.c', AUTH: 'off' }).required, false);
const config = readConfig({ ALLOWED_EMAILS: 'me@example.com', GOOGLE_CLIENT_ID: 'app-123', SESSION_SECRET: 'x'.repeat(40) });
assert.deepEqual(configProblems(config), []);

// --- Google ID tokens, signed here with a throwaway key standing in for Google's

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }];
const now = Date.UTC(2026, 10, 27);
const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function token(claims, { kid = 'test-key', alg = 'RS256', key = privateKey } = {}) {
  const head = part({ alg, kid, typ: 'JWT' });
  const body = part({
    iss: 'https://accounts.google.com',
    aud: 'app-123',
    exp: Math.floor(now / 1000) + 600,
    email: 'Me@Example.com',
    email_verified: true,
    name: 'Me',
    ...claims,
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${signature}`;
}
const verify = (t) => verifyGoogleToken(t, { clientId: 'app-123', keys, now });

assert.deepEqual(await verify(token({})), { email: 'me@example.com', name: 'Me' });
await assert.rejects(verify(token({ aud: 'someone-else' })), /different app/);
await assert.rejects(verify(token({ iss: 'https://evil.example' })), /not issued by Google/);
await assert.rejects(verify(token({ exp: Math.floor(now / 1000) - 1 })), /expired/);
await assert.rejects(verify(token({ email_verified: false })), /not verified/);
await assert.rejects(verify(token({}, { kid: 'unknown' })), /Unknown signing key/);
await assert.rejects(verify(token({}, { alg: 'none' })), /algorithm/);
// Signed by a different key: the signature must not verify.
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
await assert.rejects(verify(token({}, { key: other })), /signature/);
// Claims altered after signing.
const [h, , s] = token({}).split('.');
await assert.rejects(verify(`${h}.${part({ iss: 'https://accounts.google.com', aud: 'app-123', exp: 9e9, email: 'evil@example.com', email_verified: true })}.${s}`), /signature/);
await assert.rejects(verify('not-a-token'), /Malformed/);

// --- session cookies ----------------------------------------------------------

const session = makeSession({ email: 'me@example.com', name: 'Me' }, config.secret, now);
const cookie = `theme=dark; ${COOKIE}=${session}; other=1`;
assert.deepEqual(readSession(cookie, config, now), { email: 'me@example.com', name: 'Me' });
assert.equal(readSession('', config, now), null);
assert.equal(readSession(undefined, config, now), null);
assert.equal(readSession(cookie, config, now + 31 * 24 * 3600 * 1000), null, 'expired');
assert.equal(readSession(cookie, { ...config, secret: 'y'.repeat(40) }, now), null, 'signed with another secret');
assert.equal(readSession(cookie, { ...config, allowed: ['you@example.com'] }, now), null, 'no longer allowed');
// Changing who the cookie says you are must break its signature.
const [, mac] = session.split('.');
const forged = `${part({ email: 'you@example.com', name: 'You', exp: now + 1e9 })}.${mac}`;
assert.equal(readSession(`${COOKIE}=${forged}`, { ...config, allowed: ['you@example.com'] }, now), null, 'forged');

// --- spaces are saved and come back --------------------------------------------

assert.ok(validRoomName('default') && validRoomName('my-space_2'));
assert.ok(!validRoomName('../etc') && !validRoomName('') && !validRoomName('a/b') && !validRoomName('x'.repeat(65)));

const dir = mkdtempSync(path.join(os.tmpdir(), 'mind-palace-test-'));
try {
  const first = createRooms(dir);
  const room = first.getRoom('default');
  room.doc.getMap('items').set('a', 'hello');
  room.doc.getMap('items').set('b', 'world');
  await first.saveAll();

  // A fresh server process reading the same folder.
  const second = createRooms(dir);
  const reloaded = second.getRoom('default').doc.getMap('items');
  assert.equal(reloaded.get('a'), 'hello');
  assert.equal(reloaded.get('b'), 'world');

  // A change made after reloading merges with what a browser still holds.
  const browser = new Y.Doc();
  browser.getMap('items').set('c', 'from-browser');
  Y.applyUpdate(second.getRoom('default').doc, Y.encodeStateAsUpdate(browser));
  await second.saveAll();
  const third = createRooms(dir).getRoom('default').doc.getMap('items');
  assert.deepEqual([third.get('a'), third.get('b'), third.get('c')], ['hello', 'world', 'from-browser']);
  assert.equal(createRooms(dir).getRoom('empty').doc.getMap('items').size, 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('server: all checks passed');
process.exit(0);
