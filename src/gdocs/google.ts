import { convertDoc, imageAddresses, parseDocId, unresolvedImages, withImageAddresses } from './convert';
import type { ConvertedDoc, GoogleDoc } from './convert';
import { planPush } from './push';
import { getSession } from '../session';

/**
 * Signing in to Google and reading a document. Everything happens in the
 * browser: Google's sign-in window hands back a short-lived access token,
 * which is kept in memory only and used to call the Google Docs API directly.
 *
 * It needs a Google Cloud "OAuth client ID" belonging to whoever runs this
 * app, set as VITE_GOOGLE_CLIENT_ID in a file named .env.local.
 */

/** From .env.local while developing; from the server's settings once hosted. */
const clientId = () =>
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || getSession().clientId || '';
/** Read-only access to the user's Google Docs: all that pulling and refreshing need. */
const READ_SCOPE = 'https://www.googleapis.com/auth/documents.readonly';
/** Read and write access, asked for only when the user pushes text back to a doc. */
const WRITE_SCOPE = 'https://www.googleapis.com/auth/documents';

export const isGoogleConfigured = () => clientId() !== '';

// The small part of Google's sign-in library that is used.
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        /** Sign in with Google: identifies the person (used by the sign-in screen). */
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

let scriptLoading: Promise<void> | null = null;

export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Could not load Google sign-in. Check your internet connection.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Read-only access to the user's Google Drive, for the Library: listing files and downloading them. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const tokens = new Map<string, { value: string; expires: number }>();

/** An access token for browsing Google Drive, opening Google's sign-in window if needed. */
export const getDriveToken = () => getToken(DRIVE_SCOPE);

/** Whether Drive has already been connected in this session, so no sign-in window is needed. */
export function isDriveConnected(): boolean {
  const cached = tokens.get(DRIVE_SCOPE);
  return !!cached && cached.expires > Date.now() + 60_000;
}

/**
 * Access to files Mind Palace itself creates in Drive (its "Mind Palace"
 * folder and what is put in it), and to nothing else. Asked for only when a
 * folder is first made or something is first put in one.
 */
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const getDriveFileToken = () => getToken(DRIVE_FILE_SCOPE);

/** A Drive token already granted in this session, if any, so nothing needs a sign-in window. */
export function cachedDriveToken(): string | null {
  for (const scope of [DRIVE_SCOPE, DRIVE_FILE_SCOPE]) {
    const cached = tokens.get(scope);
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  }
  return null;
}

/** Forgets the Drive tokens, after Google has rejected one. */
export const forgetDriveToken = () => {
  tokens.delete(DRIVE_SCOPE);
  tokens.delete(DRIVE_FILE_SCOPE);
};

/** Returns an access token for a scope, opening Google's sign-in window if one is needed. */
async function getToken(scope: string): Promise<string> {
  // A write token also reads, so reuse it rather than asking twice.
  for (const s of scope === READ_SCOPE ? [WRITE_SCOPE, READ_SCOPE] : [scope]) {
    const cached = tokens.get(s);
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  }
  if (!clientId()) throw new Error('Google is not set up for this app yet.');
  await loadGoogleScript();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google sign-in did not complete.'));
          return;
        }
        tokens.set(scope, {
          value: response.access_token,
          expires: Date.now() + (response.expires_in ?? 3600) * 1000,
        });
        resolve(response.access_token);
      },
      error_callback: (error) =>
        reject(
          new Error(
            error.type === 'popup_closed'
              ? 'The Google sign-in window was closed.'
              : error.type === 'popup_failed_to_open'
                ? 'The browser blocked the Google sign-in window. Allow pop-ups for this page and try again.'
                : error.message || 'Google sign-in did not complete.',
          ),
        ),
    });
    client.requestAccessToken();
  });
}

/** Turns a failed Google response into an error a person can act on. */
async function googleError(response: Response): Promise<Error> {
  if (response.status === 401) tokens.clear();
  const detail = await response
    .json()
    .then((j: { error?: { message?: string } }) => j.error?.message)
    .catch(() => undefined);
  const reason =
    response.status === 404
      ? 'Google could not find that document.'
      : response.status === 403
        ? 'Google refused access. Check that the signed-in account can open (and, for pushing, edit) the document, and that the Google Docs API is enabled for your Google Cloud project.'
        : `Google returned an error (${response.status}).`;
  return new Error(detail ? `${reason} (${detail})` : reason);
}

async function fetchDoc(docId: string, accessToken: string): Promise<GoogleDoc> {
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}?fields=title,body.content,inlineObjects,lists`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw await googleError(response);
  return (await response.json()) as GoogleDoc;
}

/** Fetches a Google Doc by link or id and converts it to text-frame markup. */
export async function loadGoogleDoc(linkOrId: string): Promise<ConvertedDoc & { docId: string }> {
  const docId = parseDocId(linkOrId);
  if (!docId) throw new Error('That does not look like a Google Docs link.');
  const doc = await fetchDoc(docId, await getToken(READ_SCOPE));
  return { ...convertDoc(doc), docId };
}

/**
 * Copies the pictures named in `text` out of the Google Doc and into Mind
 * Palace's file store, and returns the text pointing at the copies. Pictures
 * already copied (found in `previous`, the text being replaced) are reused.
 * `missing` counts pictures that could not be copied; those are left out of the layout.
 */
export async function copyDocImages(
  text: string,
  imageSources: Record<string, string>,
  previous = '',
): Promise<{ text: string; missing: number }> {
  const addresses = imageAddresses(previous);
  let missing = 0;
  const wanted = [...new Set(unresolvedImages(text))].filter((id) => !addresses[id]);
  // A few at a time, so a long rulebook does not open dozens of downloads at once.
  const queue = [...wanted];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const response = await fetch('/link/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imageSources[id] }),
        });
        if (!response.ok) throw new Error();
        addresses[id] = ((await response.json()) as { url: string }).url;
      } catch {
        missing++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { text: withImageAddresses(text, addresses), missing };
}

/**
 * Replaces a section of a Google Doc (or the whole doc) with the layout's
 * text. Refuses if the doc has changed since `pulledText` was pulled, or holds
 * things plain text cannot carry. Returns the section's text as the doc now has it.
 */
export async function pushToGoogleDoc(
  docId: string,
  section: string | null,
  pulledText: string,
  newText: string,
): Promise<string> {
  const accessToken = await getToken(WRITE_SCOPE);
  const plan = planPush(await fetchDoc(docId, accessToken), section, pulledText, newText);
  if (!plan.ok) throw new Error(plan.reason);
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: plan.requests }),
  });
  if (!response.ok) throw await googleError(response);

  // Read the doc back, so the layout remembers exactly what the doc now says.
  const after = convertDoc(await fetchDoc(docId, accessToken));
  const text = section === null ? after.text : after.sections.find((s) => s.title === section)?.text;
  return text ?? newText;
}
