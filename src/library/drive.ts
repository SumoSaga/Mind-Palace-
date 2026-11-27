import { uploadFile } from '../files';
import { forgetDriveToken, getDriveToken } from '../gdocs/google';
import { addItem } from '../store';
import { driveKind, driveQuery, googleEditUrl, storeType } from './classify';
import type { DriveFile, LibraryTab } from './classify';

/**
 * Talking to Google Drive from the browser: listing files for the Library, and
 * bringing a chosen file into the workspace. Access is read-only.
 */

const API = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'nextPageToken,files(id,name,mimeType,thumbnailLink,iconLink,webViewLink,size,modifiedTime)';
/** Above this, a file is linked to instead of copied in: it would be slow and heavy to download in a browser. */
const MAX_COPY_BYTES = 300 * 1024 * 1024;

async function driveError(response: Response): Promise<Error> {
  if (response.status === 401) forgetDriveToken();
  const detail = await response
    .json()
    .then((j: { error?: { message?: string } }) => j.error?.message)
    .catch(() => undefined);
  const reason =
    response.status === 403
      ? 'Google refused access. The Google Drive API may not be enabled for your Google Cloud project yet.'
      : response.status === 404
        ? 'Google could not find that file.'
        : `Google Drive returned an error (${response.status}).`;
  return new Error(detail ? `${reason} (${detail})` : reason);
}

export async function listDrive(
  tab: LibraryTab,
  folderId: string,
  search: string,
  pageToken?: string,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const { q, orderBy } = driveQuery(tab, folderId, search);
  const params = new URLSearchParams({
    q,
    orderBy,
    fields: FIELDS,
    pageSize: '48',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const token = await getDriveToken();
  const response = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw await driveError(response);
  return (await response.json()) as { files: DriveFile[]; nextPageToken?: string };
}

async function download(file: DriveFile): Promise<Blob> {
  const token = await getDriveToken();
  const response = await fetch(`${API}/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await driveError(response);
  return response.blob();
}

function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
}

/**
 * Brings a Drive file into the workspace, at `location` ('desk', or a device
 * id for that device's Stage). Google Docs, Sheets and Slides open live;
 * images, PDFs, videos and 3D models are copied into Mind Palace's own file
 * store, so they keep working without Google; anything else becomes a card
 * that opens the file in Drive. Returns the new item's id.
 */
export async function addFromDrive(file: DriveFile, location: string, at: { x: number; y: number }): Promise<string> {
  const kind = driveKind(file);
  const place = (w: number, h: number) => ({ location, x: at.x - w / 2, y: at.y - h / 2, w, h });

  const google = googleEditUrl(file);
  if (google) return addItem({ type: 'embed', url: google.url, label: file.name, ...place(760, 560) });

  const tooBig = Number(file.size ?? 0) > MAX_COPY_BYTES;
  if (kind === 'other' || kind === 'folder' || tooBig) {
    return addItem({
      type: 'link',
      url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      label: 'Google Drive',
      text: file.name,
      ...place(320, 150),
    });
  }

  const blob = await download(file);
  const url = await uploadFile(blob, storeType(file));
  if (kind === 'image') {
    const { w, h } = await imageSize(blob);
    const scale = Math.min(1, 480 / w);
    return addItem({ type: 'image', src: url, ...place(w * scale, h * scale) });
  }
  const size = kind === 'pdf' ? [420, 600] : kind === 'model' ? [480, 420] : [560, 360];
  // Google's own document types were handled above, so this is a PDF, video or 3D model.
  return addItem({ type: kind as 'pdf' | 'video' | 'model', url, label: file.name, ...place(size[0], size[1]) });
}
