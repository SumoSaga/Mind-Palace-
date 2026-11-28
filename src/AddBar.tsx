import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveLink } from './embed';
import { fileKind, uploadFile } from './files';
import { readImage } from './hooks';
import { ItemMenu } from './ItemMenu';
import type { MenuOption } from './ItemMenu';
import { createFolder } from './library/folders';
import { addItem, addLayout, sendItem } from './store';

type Point = { x: number; y: number };

/** A request to open the add menu at a screen point, placing new things at `at` (surface coordinates). */
export interface AddMenuRequest {
  x: number;
  y: number;
  at: Point;
}

interface Props {
  /** Where new things go: 'desk' (not on any device) or a device id (onto its Stage). */
  location: string;
  /** A point to place new things around, in that surface's coordinates. */
  place: () => Point;
  onAdded?: (itemId: string) => void;
  onOpenLayout: (layoutId: string) => void;
  /** Set when the surface was right-clicked: opens the menu there. */
  request?: AddMenuRequest | null;
  onRequestDone?: () => void;
  /** More choices at the end of the menu, such as opening the Library. */
  extra?: MenuOption[];
}

const MAX_NEW_IMAGE_WIDTH = 480;
const local = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1';

/**
 * Bringing new things in: one compact "+ Add" button, whose menu also opens
 * where the surface is right-clicked. Text, files (images, PDFs, videos, 3D
 * models), links, layouts and Google Drive folders.
 */
export function AddBar({ location: where, place, onAdded, onOpenLayout, request, onRequestDone, extra = [] }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Where the things being added should go, fixed when the menu choice is made. */
  const target = useRef<Point>({ x: 0, y: 0 });
  const [menu, setMenu] = useState<AddMenuRequest | null>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const open = request ?? menu;

  /** Adds an item centred on the target point, a little offset for each one in a batch. */
  function add(item: Parameters<typeof addItem>[0], offset = 0) {
    const x = item.x + offset;
    const y = item.y + offset;
    // On a Stage, the place on that Stage is what shows; set it too, so the thing lands where asked.
    const onStage = where !== 'desk' ? { sx: x, sy: y, sw: item.w, sh: item.h } : {};
    const id = addItem({ ...item, location: where, x, y, ...onStage });
    onAdded?.(id);
    return id;
  }

  async function addFiles(files: File[]) {
    const at = target.current;
    let offset = 0;
    for (const file of files) {
      try {
        const kind = fileKind(file);
        if (kind) {
          // PDFs, videos and 3D models go to the file store; the item only points at them.
          setUploading((n) => n + 1);
          try {
            const url = await uploadFile(file);
            const w = kind === 'pdf' ? 420 : kind === 'model' ? 480 : 560;
            const h = kind === 'pdf' ? 600 : kind === 'model' ? 420 : 360;
            add({ type: kind, url, label: file.name, x: at.x - w / 2, y: at.y - h / 2, w, h }, offset);
          } finally {
            setUploading((n) => n - 1);
          }
        } else if (file.type.startsWith('image/')) {
          const { src, w, h } = await readImage(file);
          const scale = Math.min(1, MAX_NEW_IMAGE_WIDTH / w);
          add({ type: 'image', src, x: at.x - (w * scale) / 2, y: at.y - (h * scale) / 2, w: w * scale, h: h * scale }, offset);
        } else {
          continue;
        }
        offset += 24;
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function addLink() {
    if (linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const result = await resolveLink(link);
      const at = target.current;
      if (result.kind === 'embed') {
        const { embed } = result;
        add({ type: 'embed', url: embed.src, label: embed.label, x: at.x - embed.w / 2, y: at.y - embed.h / 2, w: embed.w, h: embed.h });
      } else {
        // The site cannot be shown inside another page: a card that opens it instead.
        const w = 320;
        const h = result.image ? 300 : 150;
        add({ type: 'link', url: result.url, label: result.label, text: result.title ?? result.label, src: result.image, x: at.x - w / 2, y: at.y - h / 2, w, h });
      }
      setLink('');
      setLinking(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function addFolder() {
    const name = folderName.trim();
    if (!name || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      const driveId = await createFolder(name);
      const at = target.current;
      add({ type: 'folder', driveId, label: name, x: at.x - 110, y: at.y - 95, w: 220, h: 190 });
      setFolderName('');
      setNaming(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setFolderBusy(false);
    }
  }

  function close() {
    setMenu(null);
    onRequestDone?.();
  }

  const options: MenuOption[] = [
    {
      label: 'Text',
      onSelect: () => {
        const at = target.current;
        add({ type: 'text', x: at.x - 130, y: at.y - 40, w: 260, h: 80, text: 'Double-click to edit' });
      },
    },
    { label: uploading ? 'File (uploading…)' : 'File: image, PDF, video, 3D', onSelect: () => fileRef.current?.click() },
    { label: 'Link', onSelect: () => setLinking(true) },
    {
      label: 'Layout',
      onSelect: () => {
        const { itemId, layoutId } = addLayout(target.current);
        if (where !== 'desk') sendItem(itemId, where);
        onAdded?.(itemId);
        onOpenLayout(layoutId);
      },
    },
    { label: 'Google Drive folder', divider: true, onSelect: () => setNaming(true) },
    ...extra,
  ];

  return (
    <>
      <button
        ref={buttonRef}
        className="add-button"
        title="Add text, files, links, layouts or a Drive folder. You can also right-click empty space."
        onClick={() => {
          const r = buttonRef.current!.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4, at: place() });
        }}
      >
        {uploading ? 'Uploading…' : '+ Add'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,video/mp4,video/webm,.glb,.gltf,.stl,.obj"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void addFiles(files);
        }}
      />

      {open && (
        <ItemMenu
          x={open.x}
          y={open.y}
          onClose={close}
          options={options.map((o) => ({
            ...o,
            onSelect: () => {
              target.current = open.at;
              o.onSelect();
            },
          }))}
        />
      )}

      {error &&
        createPortal(
          <div className="notice" role="alert">
            Could not add {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>,
          document.body,
        )}

      {naming &&
        createPortal(
          <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setNaming(false)}>
            <form
              className="modal"
              role="dialog"
              aria-label="New Google Drive folder"
              onSubmit={(e) => {
                e.preventDefault();
                void addFolder();
              }}
            >
              <h2>New Google Drive folder</h2>
              {!local() ? (
                <p className="error">
                  Google only allows sign-in on the computer running Mind Palace, at localhost. Make the folder there,
                  then send it to this device.
                </p>
              ) : (
                <>
                  <p>
                    Makes a folder inside a <b>Mind Palace</b> folder in your Google Drive, and puts it here as a card.
                    Drop pictures or files from your computer on the card, or drag things on the canvas onto it, to save
                    them in the folder. Open it to see what is inside and drag things back out.
                  </p>
                  <p className="connect-note">
                    Google will ask to let Mind Palace create files. That permission only reaches files Mind Palace
                    makes, not the rest of your Drive.
                  </p>
                  <label className="field">
                    Folder name
                    <input autoFocus value={folderName} placeholder="Character art" onChange={(e) => setFolderName(e.target.value)} />
                  </label>
                </>
              )}
              {folderError && <p className="error wrap">{folderError}</p>}
              <div className="modal-actions">
                <button type="button" onClick={() => setNaming(false)}>
                  Cancel
                </button>
                {local() && (
                  <button type="submit" className="primary" disabled={!folderName.trim() || folderBusy}>
                    {folderBusy ? 'Making the folder…' : 'Make folder'}
                  </button>
                )}
              </div>
            </form>
          </div>,
          document.body,
        )}

      {linking &&
        createPortal(
          <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setLinking(false)}>
            <form
              className="modal"
              role="dialog"
              aria-label="Add a link"
              onSubmit={(e) => {
                e.preventDefault();
                void addLink();
              }}
            >
              <h2>Add a link</h2>
              <p>
                A link to a Google Doc, Sheet or Slides file, or to a YouTube or Vimeo video, appears live so you can
                use it here. Most other websites do not allow themselves to be shown inside another page; those become
                a card that opens the site in a new tab.
              </p>
              <p className="connect-note">For YouTube, use the link to a video or playlist, not the YouTube home page.</p>
              <label className="field">
                Link
                <input autoFocus value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} />
              </label>
              {linkError && <p className="error">{linkError}</p>}
              <div className="modal-actions">
                <button type="button" onClick={() => setLinking(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={!link.trim() || linkBusy}>
                  {linkBusy ? 'Checking the link…' : 'Add'}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

/** True when a right-click landed on empty surface rather than on an item or a control. */
export function onEmptySurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && !el.closest('.item, .marker, button, input, select, textarea, .toolbar, .dock, .library, .ov-card');
}
