/**
 * Large files (PDFs, videos, 3D models) are not kept inside the synced
 * workspace. They are uploaded to the file store, and the workspace holds only
 * their address, so every device can load them without the workspace growing.
 */

export type FileKind = 'pdf' | 'video' | 'model';

/** The file type the store should record for a 3D model, from its name. */
export function modelType(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'glb') return 'model/gltf-binary';
  if (ext === 'gltf') return 'model/gltf+json';
  if (ext === 'stl') return 'model/stl';
  if (ext === 'obj') return 'model/obj';
  return null;
}

export function fileKind(file: { type: string; name: string }): FileKind | null {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'video/mp4' || file.type === 'video/webm') return 'video';
  // Browsers rarely know a type for 3D files, so those are recognised by name.
  if (modelType(file.name)) return 'model';
  return null;
}

/** Uploads a file (or downloaded data) and returns the address it can be loaded from. */
export async function uploadFile(file: Blob & { name?: string }, type?: string): Promise<string> {
  const contentType = type ?? (file.name ? modelType(file.name) : null) ?? file.type;
  const response = await fetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
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
