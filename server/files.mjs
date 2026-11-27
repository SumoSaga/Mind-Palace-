// Development file store: keeps uploaded files on this computer's disk and
// serves them to every device in the space. It stands in for cloud storage,
// which replaces it later.
//
//   POST /files          body = the file, Content-Type = its type  ->  { id, url }
//   GET  /files/<id>     the file, with support for partial requests (video seeking)
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const DIR = path.join(
  process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'),
  'files',
);
const MAX_BYTES = 4 * 1024 ** 3;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only types the app shows are accepted. In particular nothing a browser would
// run as a page or script, since files are served from the app's own address.
const ALLOWED = new Set([
  'application/pdf',
  'video/mp4',
  'video/webm',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // 3D models
  'model/gltf-binary',
  'model/gltf+json',
  'model/stl',
  'model/obj',
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Saves data the server fetched itself (a picture from a Google Doc). */
export async function storeBytes(type, bytes) {
  if (!ALLOWED.has(type)) throw new Error('unsupported type');
  await mkdir(DIR, { recursive: true });
  const id = randomUUID();
  const file = path.join(DIR, id);
  await writeFile(file, bytes);
  await writeFile(`${file}.json`, JSON.stringify({ type, size: bytes.length }));
  return { id, url: `/files/${id}` };
}

export async function handleFiles(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/files') {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED.has(type)) return json(res, 415, { error: 'That kind of file is not supported.' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) return json(res, 413, { error: 'That file is too large.' });

    await mkdir(DIR, { recursive: true });
    const id = randomUUID();
    const file = path.join(DIR, id);
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) req.destroy(new Error('too large'));
    });
    try {
      await pipeline(req, createWriteStream(file));
    } catch {
      await rm(file, { force: true });
      return json(res, 413, { error: 'The upload did not complete.' });
    }
    await writeFile(`${file}.json`, JSON.stringify({ type, size }));
    return json(res, 201, { id, url: `/files/${id}` });
  }

  const match = /^\/files\/([^/]+)$/.exec(url.pathname);
  if ((req.method === 'GET' || req.method === 'HEAD') && match && ID.test(match[1])) {
    const file = path.join(DIR, match[1]);
    let meta;
    try {
      meta = JSON.parse(await readFile(`${file}.json`, 'utf8'));
    } catch {
      return json(res, 404, { error: 'Not found' });
    }
    const headers = {
      'Content-Type': meta.type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    };

    // A partial request, as a video player makes when seeking.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = meta.size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, meta.size - Number(range[2]));
      }
      if (start > end || start >= meta.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${meta.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${meta.size}`, 'Content-Length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': meta.size });
    }
    if (req.method === 'HEAD' || meta.size === 0) return res.end();
    return pipeline(createReadStream(file, { start, end }), res).catch(() => {});
  }

  return json(res, 404, { error: 'Not found' });
}
