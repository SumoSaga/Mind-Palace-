import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { showNotice } from '../notice';
import type { Item } from '../store';
import type { DriveFile } from './classify';
import { onFolderChanged, openFolder, peekFolder, uploadToFolder } from './folders';

/**
 * A Mind Palace folder on the canvas: its name, a peek at what is inside, and
 * a button to open it. Drop pictures or files from the computer on it, or drag
 * things on the canvas onto it, to save them into the folder in Google Drive.
 */
export function FolderCard({ item }: { item: Item }) {
  const folderId = item.driveId ?? '';
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [version, setVersion] = useState(0);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(0);

  useEffect(() => onFolderChanged((id) => id === folderId && setVersion((v) => v + 1)), [folderId]);
  useEffect(() => {
    let live = true;
    peekFolder(folderId)
      .then((list) => live && setFiles(list))
      .catch(() => live && setFiles(null));
    return () => {
      live = false;
    };
  }, [folderId, version]);

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // not also added to the canvas
    setOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    for (const file of dropped) {
      setSaving((n) => n + 1);
      try {
        await uploadToFolder(folderId, file, file.name);
        showNotice(`Saved ${file.name} in ${item.label ?? 'the folder'}.`);
      } catch (err) {
        showNotice(`${file.name} was not saved: ${err instanceof Error ? err.message : String(err)}`, true);
      } finally {
        setSaving((n) => n - 1);
      }
    }
  }

  const open = () => openFolder({ id: folderId, name: item.label ?? 'Folder' });

  return (
    <div
      className={`folder-card${over ? ' folder-target' : ''}`}
      data-folder={folderId}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
      onDoubleClick={open}
    >
      <div className="folder-tab" />
      <div className="folder-peek">
        {files?.slice(0, 4).map((f) =>
          f.thumbnailLink ? (
            <img key={f.id} src={f.thumbnailLink} alt="" draggable={false} referrerPolicy="no-referrer" />
          ) : (
            <span key={f.id}>{f.name}</span>
          ),
        )}
      </div>
      <strong>{item.label ?? 'Folder'}</strong>
      <span className="folder-count">
        {saving
          ? 'Saving…'
          : files
            ? `${files.length} ${files.length === 1 ? 'item' : 'items'} · drop things here`
            : 'Google Drive folder · drop things here'}
      </span>
      <button onPointerDown={(e) => e.stopPropagation()} onClick={open}>
        Open
      </button>
    </div>
  );
}
