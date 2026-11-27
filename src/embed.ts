/**
 * Turns a pasted link into something for the Desk.
 *
 * Some things can be shown live in a frame: a Google Doc, Sheet or Slides file
 * you can edit in place, or a YouTube or Vimeo video. Those are recognised
 * here.
 *
 * Most other websites tell browsers not to display them inside another page,
 * and a web app cannot override that. So for any other link the server is
 * asked (see server/link.mjs) whether the page allows it: if so it is shown
 * live, and if not it becomes a card that opens the site in a new tab.
 */
export interface Embed {
  /** The address the frame loads. */
  src: string;
  /** A short label for the item's title bar. */
  label: string;
  /** A sensible starting size on the Desk, in pixels. */
  w: number;
  h: number;
}

/** What a link turns into on the Desk. */
export type LinkResult =
  | { kind: 'embed'; embed: Embed; url: string }
  | { kind: 'card'; url: string; label: string; title?: string; description?: string; image?: string };

const GOOGLE_KINDS: Record<string, string> = {
  document: 'Google Doc',
  spreadsheets: 'Google Sheet',
  presentation: 'Google Slides',
};

function parse(input: string): URL | null {
  try {
    const text = input.trim();
    // Allow "youtube.com/..." typed without the https:// in front.
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Links that are known to work in a frame. Returns null for everything else. */
export function knownEmbed(input: string): Embed | null {
  const url = parse(input);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'docs.google.com') {
    const m = /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (m) return { src: `https://docs.google.com/${m[1]}/d/${m[2]}/edit`, label: GOOGLE_KINDS[m[1]], w: 760, h: 560 };
  }

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    let video: string | null = null;
    if (host === 'youtu.be') video = url.pathname.slice(1);
    else if (url.pathname === '/watch') video = url.searchParams.get('v');
    else video = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
    const list = url.searchParams.get('list');
    if (video && /^[A-Za-z0-9_-]{6,}$/.test(video)) {
      return { src: `https://www.youtube-nocookie.com/embed/${video}`, label: 'YouTube', w: 560, h: 339 };
    }
    if (url.pathname === '/playlist' && list && /^[A-Za-z0-9_-]+$/.test(list)) {
      return { src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, label: 'YouTube playlist', w: 560, h: 339 };
    }
    return null; // YouTube's home, search and channel pages cannot be framed
  }

  if (host === 'vimeo.com') {
    const id = /^\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return { src: `https://player.vimeo.com/video/${id}`, label: 'Vimeo', w: 560, h: 339 };
  }
  return null;
}

/** Works out what a link should become, asking the server about pages that are not recognised. */
export async function resolveLink(input: string): Promise<LinkResult> {
  const url = parse(input);
  if (!url) throw new Error('Enter a web address, such as https://example.com');
  const known = knownEmbed(url.href);
  if (known) return { kind: 'embed', embed: known, url: url.href };

  const host = url.hostname.replace(/^www\./, '');
  let info: { url?: string; embeddable?: boolean; title?: string; description?: string; image?: string } = {};
  try {
    const response = await fetch('/link/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.href }),
    });
    if (response.ok) info = await response.json();
  } catch {
    // If the check cannot be made, fall through to a card: it always works.
  }
  if (info.embeddable && url.protocol === 'https:') {
    return { kind: 'embed', embed: { src: info.url ?? url.href, label: info.title ?? host, w: 640, h: 480 }, url: url.href };
  }
  return { kind: 'card', url: info.url ?? url.href, label: host, title: info.title, description: info.description, image: info.image };
}
