import { cachedDriveToken, getDriveFileToken } from '../gdocs/google';
import type { Item } from '../store';
import type { DriveFile } from './classify';
import { driveError } from './drive';

/**
 * Mind Palace folders: real folders in Google Drive, inside one folder named
 * "Mind Palace" that the app makes the first time it is needed. A folder shows
 * on the canvas as a card; things dropped on the card are saved into the
 * folder in Drive, and opening it lists what is there.
 *
 * Writing uses Google's "drive.file" permission, which only reaches files and
 * folders this app has made itself, never the rest of the Drive.
 */

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
/** Small files go in one request; larger ones in Google's two-step upload. */
const SIMPLE_LIMIT = 4 * 1024 * 1024;

// --- events: a folder's contents changed; a folder should be opened ----------

const changed = new Set<(folderId: string) => void>();
export function onFolderChanged(listener: (folderId: string) => void) {
  changed.add(listener);
  return () => void changed.delete(listener);
}

export interface FolderRef {
  id: string;
  name: string;
}
const openers = new Set<(folder: FolderRef) => void>();
/** Opens a folder in the Library panel. */
export const openFolder = (folder: FolderRef) => openers.forEach((l) => l(folder));
export function onOpenFolder(listener: (folder: FolderRef) => void) {
  openers.add(listener);
  return () => void openers.delete(listener);
}

// --- Drive requests ------------------------------------------------------------

async function drive<T>(url: string, init: RequestInit, token: string): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw await driveError(response);
  return (await response.json()) as T;
}

let rootFolder: Promise<string> | null = null;

/** The "Mind Palace" folder at the top of My Drive, made if it is not there yet. */
function mindPalaceFolder(token: string): Promise<string> {
  rootFolder ??= (async () => {
    const q = "appProperties has { key='mindPalace' and value='root' } and trashed = false";
    const found = await drive<{ files: Array<{ id: string }> }>(
      `${API}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`,
      {},
      token,
    );
    if (found.files[0]) return found.files[0].id;
    const made = await drive<{ id: string }>(
      `${API}?fields=id`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mind Palace', mimeType: FOLDER_TYPE, appProperties: { mindPalace: 'root' } }),
      },
      token,
    );
    return made.id;
  })().catch((err: unknown) => {
    rootFolder = null;
    throw err;
  });
  return rootFolder;
}

/** Makes a folder inside "Mind Palace" in Google Drive and returns its id. */
export async function createFolder(name: string): Promise<string> {
  const token = await getDriveFileToken();
  const parent = await mindPalaceFolder(token);
  const made = await drive<{ id: string }>(
    `${API}?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parent], appProperties: { mindPalace: 'folder' } }),
    },
    token,
  );
  return made.id;
}

/**
 * Saves data into a folder in Drive. With `convertTo`, Google turns it into
 * one of its own types (plain text into a Google Doc).
 */
export async function uploadToFolder(folderId: string, blob: Blob, name: string, convertTo?: string): Promise<void> {
  const token = await getDriveFileToken();
  const type = blob.type || 'application/octet-stream';
  const meta = JSON.stringify({ name, parents: [folderId], ...(convertTo ? { mimeType: convertTo } : {}) });
  if (blob.size <= SIMPLE_LIMIT) {
    const boundary = `mindpalace${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    await drive(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, token);
  } else {
    const start = await fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
      body: meta,
    });
    if (!start.ok) throw await driveError(start);
    const session = start.headers.get('Location');
    if (!session) throw new Error('Google did not accept the upload. Try a smaller file.');
    const put = await fetch(session, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
    if (!put.ok) throw await driveError(put);
  }
  changed.forEach((l) => l(folderId));
}

/**
 * What is in a folder, newest first. Uses a Drive token already granted in
 * this session; returns null when there is none, rather than opening a sign-in window.
 */
export async function peekFolder(folderId: string): Promise<DriveFile[] | null> {
  const token = cachedDriveToken();
  if (!token) return null;
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,thumbnailLink)',
    pageSize: '50',
  });
  const result = await drive<{ files: DriveFile[] }>(`${API}?${params}`, {}, token);
  return result.files;
}

// --- putting workspace items into a folder --------------------------------------

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** True for the kinds of item that can be saved into a folder. */
export const canGoInFolder = (item: Item) =>
  item.type === 'image' || item.type === 'text' || item.type === 'pdf' || item.type === 'video' || item.type === 'model';

/** Saves a workspace item into a Drive folder: pictures and files as they are, text as a Google Doc. */
export async function putItemInFolder(item: Item, folderId: string): Promise<void> {
  if (item.type === 'text') {
    const text = item.text ?? '';
    const first = text.replace(/[#*_{}]/g, '').trim().split('\n')[0].slice(0, 60).trim();
    await uploadToFolder(folderId, new Blob([text], { type: 'text/plain' }), first || 'Text', GOOGLE_DOC);
    return;
  }
  const address = item.type === 'image' ? item.src : item.url;
  if (!address || !canGoInFolder(item)) throw new Error('Only pictures, text, PDFs, videos and 3D models can be put in a folder.');
  const blob = await (await fetch(address)).blob();
  const extension = EXTENSIONS[blob.type];
  const name = item.label ?? (extension ? `Picture.${extension}` : 'File');
  await uploadToFolder(folderId, blob, name);
}
