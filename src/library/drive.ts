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

export async function driveError(response: Response): Promise<Error> {
  if (response.status === 401) forgetDriveToken();
  const detail = await response
    .json()
    .then((j: { error?: { message?: string } }) => j.error?.message)
    .catch(() => undefined);
  // The commonest first-time problem: the Drive API is switched off for the Cloud project.
  const project = detail && /project[= ](\d+)/.exec(detail)?.[1];
  if (response.status === 403 && detail && /has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) {
    return new Error(
      `The Google Drive API is switched off for your Google Cloud project. Turn it on here (it is free): https://console.cloud.google.com/apis/library/drive.googleapis.com${project ? `?project=${project}` : ''} then wait a minute and try again.`,
    );
  }
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

export async function download(file: DriveFile): Promise<Blob> {
  const token = await getDriveToken();
  const response = await fetch(`${API}/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await driveError(response);
  return response.blob();
}

export function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
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

/** Renders one page of a PDF to a PNG picture. */
async function pdfPagePicture(blob: Blob, pageNumber = 1): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
    // About 200 dots per inch: sharp enough to print.
    const viewport = page.getViewport({ scale: 200 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be drawn.'))), 'image/png'),
    );
  } finally {
    void task.destroy();
  }
}

/**
 * A Drive file as a picture, for placing on a layout page: images as they
 * are, Google Drawings and Slides (first slide) exported as PNG, and the first
 * page of a PDF. Throws for anything that cannot be shown as a picture.
 */
export async function drivePicture(file: DriveFile): Promise<Blob> {
  const kind = driveKind(file);
  if (kind === 'image') return download(file);
  if (kind === 'pdf') return pdfPagePicture(await download(file));
  if (file.mimeType === 'application/vnd.google-apps.drawing' || kind === 'gslides') {
    const token = await getDriveToken();
    const response = await fetch(`${API}/${encodeURIComponent(file.id)}/export?mimeType=image/png`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw await driveError(response);
    return response.blob();
  }
  throw new Error('Only pictures, PDFs, Google Docs, Drawings and Slides can be placed on a layout page.');
}
