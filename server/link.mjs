// Looks at a web address before it is added to the Desk, to answer two things:
// can this page be shown inside Mind Palace, and what should its card say if not.
//
// Most websites tell browsers not to display them inside another page (banks,
// shops, YouTube's own pages and so on). There is no way round that from
// inside a web page, so those links become a card that opens the site in a
// new tab. Pages that do allow it are shown live.
//
// Because this makes the server fetch an address someone typed, it only ever
// contacts public internet addresses, never this computer or the home network.
import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 96 * 1024;

export class LinkError extends Error {}

/** True for addresses that are this computer, a home or office network, or otherwise not the public internet. */
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
  }
  return true;
}

async function assertPublic(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LinkError('Only web links can be added.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new LinkError('That address could not be found.');
  if (addresses.some(isPrivateAddress)) throw new LinkError('Links to this computer or your home network cannot be checked.');
}

/** Whether response headers forbid showing the page inside another site. */
export function forbidsEmbedding(headers) {
  const xfo = (headers.get('x-frame-options') ?? '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;
  const csp = (headers.get('content-security-policy') ?? '').toLowerCase();
  const ancestors = /frame-ancestors([^;]*)/.exec(csp)?.[1]?.trim();
  // Any frame-ancestors rule other than "anyone" excludes us.
  if (ancestors !== undefined && !/(^|\s)\*(\s|$)/.test(ancestors)) return true;
  return false;
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

/** Pulls a title and preview image out of a page's HTML. */
export function readPageInfo(html, baseUrl) {
  const meta = (name) => {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0];
    return tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
  };
  const title = meta('og:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  let image = meta('og:image');
  try {
    if (image) image = new URL(decodeEntities(image), baseUrl).href;
    if (image && !image.startsWith('https://')) image = undefined;
  } catch {
    image = undefined;
  }
  return {
    title: title ? decodeEntities(title).slice(0, 160) : undefined,
    description: meta('og:description') ? decodeEntities(meta('og:description')).slice(0, 240) : undefined,
    image,
  };
}

/**
 * @returns {Promise<{ url: string, embeddable: boolean, title?: string, description?: string, image?: string }>}
 */
export async function checkLink(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new LinkError('That does not look like a web address.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response;
    // Follow redirects by hand, so each hop is checked before it is contacted.
    for (let hop = 0; ; hop++) {
      await assertPublic(url);
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-preview)', Accept: 'text/html,*/*;q=0.5' },
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) throw new LinkError('That link redirects too many times.');
      await response.body?.cancel();
      url = new URL(location, url);
    }

    let info = {};
    if ((response.headers.get('content-type') ?? '').includes('html') && response.body) {
      // Read only the start of the page: the title and preview tags are in its head.
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (size < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      await reader.cancel().catch(() => {});
      info = readPageInfo(Buffer.concat(chunks).toString('utf8'), url);
    } else {
      await response.body?.cancel();
    }
    return { url: url.href, embeddable: response.ok && !forbidsEmbedding(response.headers), ...info };
  } catch (err) {
    if (err instanceof LinkError) throw err;
    throw new LinkError(err?.name === 'AbortError' ? 'That site took too long to answer.' : 'That site could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
