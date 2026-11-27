/**
 * Turns a pasted link into something that can be shown live on the Desk in a
 * frame: a Google Doc, Sheet or Slides file you can edit in place, or a
 * YouTube or Vimeo video. Other https links are framed as they are, which
 * works only for sites that allow being embedded.
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

const GOOGLE_KINDS: Record<string, string> = {
  document: 'Google Doc',
  spreadsheets: 'Google Sheet',
  presentation: 'Google Slides',
};

export function toEmbed(input: string): Embed | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'docs.google.com') {
    const m = /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (m) {
      return { src: `https://docs.google.com/${m[1]}/d/${m[2]}/edit`, label: GOOGLE_KINDS[m[1]], w: 760, h: 560 };
    }
  }

  let video: string | null = null;
  if (host === 'youtu.be') video = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') video = url.searchParams.get('v');
    else video = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (video && /^[A-Za-z0-9_-]{6,}$/.test(video)) {
    return { src: `https://www.youtube-nocookie.com/embed/${video}`, label: 'YouTube', w: 560, h: 339 };
  }

  if (host === 'vimeo.com') {
    const id = /^\/(\d+)/.exec(url.pathname)?.[1];
    if (id) return { src: `https://player.vimeo.com/video/${id}`, label: 'Vimeo', w: 560, h: 339 };
  }

  return { src: url.href, label: host, w: 640, h: 480 };
}
