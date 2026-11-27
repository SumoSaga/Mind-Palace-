/**
 * Large files (PDFs, videos) are not kept inside the synced workspace. They are
 * uploaded to the file store, and the workspace holds only their address, so
 * every device can load them without the workspace itself growing.
 */

export type FileKind = 'pdf' | 'video';

export function fileKind(file: File): FileKind | null {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'video/mp4' || file.type === 'video/webm') return 'video';
  return null;
}

/** Uploads a file and returns the address it can be loaded from. */
export async function uploadFile(file: File): Promise<string> {
  const response = await fetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => undefined);
    throw new Error(message ?? `The upload failed (${response.status}).`);
  }
  return ((await response.json()) as { url: string }).url;
}
