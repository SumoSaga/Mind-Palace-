// Checks the link inspector's rules without contacting the internet.
// Run with: node scripts/test-link.mjs
import assert from 'node:assert/strict';
import { checkLink, forbidsEmbedding, isPrivateAddress, readPageInfo, LinkError } from '../server/link.mjs';

// Addresses the server must never be made to contact.
for (const a of ['127.0.0.1', '10.1.2.3', '192.168.40.103', '172.16.0.1', '172.31.255.255', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', 'not-an-ip']) {
  assert.equal(isPrivateAddress(a), true, a);
}
for (const a of ['8.8.8.8', '142.250.72.14', '172.32.0.1', '192.169.0.1', '2607:f8b0:4005:80a::200e']) {
  assert.equal(isPrivateAddress(a), false, a);
}
await assert.rejects(checkLink('http://localhost:1234/files'), LinkError);
await assert.rejects(checkLink('http://192.168.1.1/'), /home network/);
await assert.rejects(checkLink('http://[::1]/'), /home network/);
await assert.rejects(checkLink('file:///c:/windows/win.ini'), /Only web links/);
await assert.rejects(checkLink('not a link'), /does not look like/);

// Which pages refuse to be shown inside another site.
const h = (obj) => new Headers(obj);
assert.equal(forbidsEmbedding(h({})), false);
assert.equal(forbidsEmbedding(h({ 'x-frame-options': 'DENY' })), true);
assert.equal(forbidsEmbedding(h({ 'X-Frame-Options': 'SAMEORIGIN' })), true);
assert.equal(forbidsEmbedding(h({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" })), true);
assert.equal(forbidsEmbedding(h({ 'content-security-policy': "frame-ancestors 'none'" })), true);
assert.equal(forbidsEmbedding(h({ 'content-security-policy': 'frame-ancestors https://example.com' })), true);
assert.equal(forbidsEmbedding(h({ 'content-security-policy': 'frame-ancestors *' })), false);
assert.equal(forbidsEmbedding(h({ 'content-security-policy': "default-src 'self'" })), false);

// Title and preview image.
const page = `<html><head><title> Plain &amp; Simple </title>
  <meta property="og:title" content="The &quot;Real&quot; Title">
  <meta content="A short summary." property="og:description">
  <meta property="og:image" content="/img/card.png"></head></html>`;
assert.deepEqual(readPageInfo(page, new URL('https://example.com/a/b')), {
  title: 'The "Real" Title',
  description: 'A short summary.',
  image: 'https://example.com/img/card.png',
});
assert.deepEqual(readPageInfo('<title>Only a title</title>', new URL('https://example.com')), { title: 'Only a title', description: undefined, image: undefined });
assert.equal(readPageInfo('<meta property="og:image" content="http://insecure.example/x.png">', new URL('https://example.com')).image, undefined, 'non-https images are dropped');
assert.deepEqual(readPageInfo('', new URL('https://example.com')), { title: undefined, description: undefined, image: undefined });

console.log('link inspector: all checks passed');
