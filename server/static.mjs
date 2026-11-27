// Serves the built app (the `dist` folder made by `npm run build`), so that in
// production one server is the whole of Mind Palace. During development Vite
// serves the app instead and this is not used.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function fileAt(urlPath) {
  const target = path.resolve(DIST, `.${path.posix.normalize(`/${urlPath}`)}`);
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return null; // outside the app folder
  try {
    const info = await stat(target);
    return info.isFile() ? { target, size: info.size } : null;
  } catch {
    return null;
  }
}

export async function handleStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  // Any address that is not a file is the app itself.
  const found = (await fileAt(pathname)) ?? (await fileAt('index.html'));
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('The app has not been built yet. Run "npm run build", or use "npm run dev" while developing.');
  }
  const hashed = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(found.target).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': found.size,
    // Built assets have their content in their name, so they can be cached for good.
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(found.target).pipe(res);
}
