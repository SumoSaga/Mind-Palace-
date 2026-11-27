import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveLink } from './embed';
import { fileKind, uploadFile } from './files';
import { readImage } from './hooks';
import { addItem, addLayout, sendItem } from './store';

interface Props {
  /** Where new things go: 'desk' (not on any device) or a device id (onto its Stage). */
  location: string;
  /** A point to place new things around, in that surface's coordinates. */
  place: () => { x: number; y: number };
  onAdded?: (itemId: string) => void;
  onOpenLayout: (layoutId: string) => void;
}

const MAX_NEW_IMAGE_WIDTH = 480;

/**
 * The buttons for bringing new things in: text, files (images, PDFs, videos),
 * links and layouts. Used on a Stage and on the Overview.
 */
export function AddBar({ location, place, onAdded, onOpenLayout }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Adds an item centred on the place point, a little offset for each one in a batch. */
  function add(item: Parameters<typeof addItem>[0], offset = 0) {
    const id = addItem({ ...item, location, x: item.x + offset, y: item.y + offset });
    onAdded?.(id);
    return id;
  }

  async function addFiles(files: File[]) {
    const at = place();
    let offset = 0;
    for (const file of files) {
      try {
        const kind = fileKind(file);
        if (kind) {
          // PDFs and videos go to the file store; the item only points at them.
          setUploading((n) => n + 1);
          try {
            const url = await uploadFile(file);
            const w = kind === 'pdf' ? 420 : 560;
            const h = kind === 'pdf' ? 600 : 360;
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
      const at = place();
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

  return (
    <>
      <button
        onClick={() => {
          const at = place();
          add({ type: 'text', x: at.x - 130, y: at.y - 40, w: 260, h: 80, text: 'Double-click to edit' });
        }}
      >
        Add text
      </button>
      <button onClick={() => fileRef.current?.click()} title="Add images, PDFs or videos (MP4, WebM)">
        {uploading ? 'Uploading…' : 'Add file'}
      </button>
      <button onClick={() => setLinking(true)} title="A video, a Google Doc, Sheet or Slides file, or any web page">
        Add link
      </button>
      <button
        onClick={() => {
          const { itemId, layoutId } = addLayout(place());
          if (location !== 'desk') sendItem(itemId, location);
          onAdded?.(itemId);
          onOpenLayout(layoutId);
        }}
      >
        New layout
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,video/mp4,video/webm"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void addFiles(files);
        }}
      />

      {error &&
        createPortal(
          <div className="notice" role="alert">
            Could not add {error}
            <button onClick={() => setError(null)}>Dismiss</button>
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
