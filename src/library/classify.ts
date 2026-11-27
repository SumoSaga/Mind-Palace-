/**
 * Working out what a Google Drive file is, how to ask Drive for a list of
 * files, and what each kind of file becomes in the workspace.
 *
 * No imports, so Node can run this file in tests.
 */

/** A file as Google Drive describes it. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  iconLink?: string;
  webViewLink?: string;
  /** Size in bytes, as text. Missing for Google's own document types. */
  size?: string;
  modifiedTime?: string;
}

export type DriveKind = 'folder' | 'gdoc' | 'gsheet' | 'gslides' | 'image' | 'pdf' | 'video' | 'model' | 'other';

const GOOGLE_APPS: Record<string, { kind: DriveKind; path: string; label: string }> = {
  'application/vnd.google-apps.document': { kind: 'gdoc', path: 'document', label: 'Google Doc' },
  'application/vnd.google-apps.spreadsheet': { kind: 'gsheet', path: 'spreadsheets', label: 'Google Sheet' },
  'application/vnd.google-apps.presentation': { kind: 'gslides', path: 'presentation', label: 'Google Slides' },
};

/** Image types the workspace can show and edit. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MODEL_EXTENSIONS: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  stl: 'model/stl',
  obj: 'model/obj',
};

const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';

export function driveKind(file: Pick<DriveFile, 'mimeType' | 'name'>): DriveKind {
  if (file.mimeType === 'application/vnd.google-apps.folder') return 'folder';
  const app = GOOGLE_APPS[file.mimeType];
  if (app) return app.kind;
  if (IMAGE_TYPES.has(file.mimeType)) return 'image';
  if (file.mimeType === 'application/pdf') return 'pdf';
  if (file.mimeType === 'video/mp4' || file.mimeType === 'video/webm') return 'video';
  if (MODEL_EXTENSIONS[extension(file.name)]) return 'model';
  return 'other';
}

/** The address that opens a Google Doc, Sheet or Slides file for editing, to show it live. */
export function googleEditUrl(file: Pick<DriveFile, 'mimeType' | 'id'>): { url: string; label: string } | null {
  const app = GOOGLE_APPS[file.mimeType];
  return app ? { url: `https://docs.google.com/${app.path}/d/${file.id}/edit`, label: app.label } : null;
}

/** The type to record in the file store for a downloaded Drive file. */
export function storeType(file: Pick<DriveFile, 'mimeType' | 'name'>): string {
  return MODEL_EXTENSIONS[extension(file.name)] ?? file.mimeType;
}

export const KIND_WORD: Record<DriveKind, string> = {
  folder: 'Folder',
  gdoc: 'Google Doc',
  gsheet: 'Google Sheet',
  gslides: 'Google Slides',
  image: 'Image',
  pdf: 'PDF',
  video: 'Video',
  model: '3D model',
  other: 'File',
};

export type LibraryTab = 'recent' | 'drive' | 'docs' | 'images' | 'models';

/** Quotes a value for use inside a Drive search. */
const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * The search to send to Google Drive for a tab of the library.
 * @param folderId the folder being browsed on the "drive" tab ('root' for the top)
 * @param search   words to look for in file names; searches everywhere, not just the open folder
 */
export function driveQuery(tab: LibraryTab, folderId: string, search: string): { q: string; orderBy: string } {
  const parts = ['trashed = false'];
  let orderBy = 'modifiedTime desc';
  const words = search.trim();
  if (tab === 'recent') {
    parts.push("mimeType != 'application/vnd.google-apps.folder'");
    orderBy = 'viewedByMeTime desc';
  } else if (tab === 'drive') {
    if (!words) {
      parts.push(`${quote(folderId)} in parents`);
      orderBy = 'folder,name';
    }
  } else if (tab === 'docs') {
    parts.push("mimeType = 'application/vnd.google-apps.document'");
  } else if (tab === 'images') {
    parts.push("mimeType contains 'image/'");
  } else if (tab === 'models') {
    parts.push(`(${Object.keys(MODEL_EXTENSIONS).map((ext) => `name contains ${quote(`.${ext}`)}`).join(' or ')})`);
  }
  if (words) parts.push(`name contains ${quote(words)}`);
  return { q: parts.join(' and '), orderBy };
}
