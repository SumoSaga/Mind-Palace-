import { convertDoc, parseDocId } from './convert';
import type { ConvertedDoc, GoogleDoc } from './convert';

/**
 * Signing in to Google and reading a document. Everything happens in the
 * browser: Google's sign-in window hands back a short-lived access token,
 * which is kept in memory only and used to call the Google Docs API directly.
 *
 * It needs a Google Cloud "OAuth client ID" belonging to whoever runs this
 * app, set as VITE_GOOGLE_CLIENT_ID in a file named .env.local.
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';
/** Read-only access to the user's Google Docs. */
const SCOPE = 'https://www.googleapis.com/auth/documents.readonly';

export const isGoogleConfigured = () => CLIENT_ID !== '';

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

function loadGoogleScript(): Promise<void> {
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

let token: { value: string; expires: number } | null = null;

/** Returns an access token, opening Google's sign-in window if one is needed. */
async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  if (!CLIENT_ID) throw new Error('Google is not set up for this app yet.');
  await loadGoogleScript();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google sign-in did not complete.'));
          return;
        }
        token = { value: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000 };
        resolve(token.value);
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

/** Fetches a Google Doc by link or id and converts it to text-frame markup. */
export async function loadGoogleDoc(linkOrId: string): Promise<ConvertedDoc & { docId: string }> {
  const docId = parseDocId(linkOrId);
  if (!docId) throw new Error('That does not look like a Google Docs link.');
  const accessToken = await getToken();
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}?fields=title,body.content`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    if (response.status === 401) token = null;
    const detail = await response
      .json()
      .then((j: { error?: { message?: string } }) => j.error?.message)
      .catch(() => undefined);
    const reason =
      response.status === 404
        ? 'Google could not find that document.'
        : response.status === 403
          ? 'Google refused access. Check that the signed-in account can open the document, and that the Google Docs API is enabled for your Google Cloud project.'
          : `Google returned an error (${response.status}).`;
    throw new Error(detail ? `${reason} (${detail})` : reason);
  }
  const doc = (await response.json()) as GoogleDoc;
  return { ...convertDoc(doc), docId };
}
