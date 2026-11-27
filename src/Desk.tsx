import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { BackgroundButtons } from './bg/removeBackground';
import { resolveLink } from './embed';
import { fileKind, uploadFile } from './files';
import { readImage, useEditingKeys, usePanZoom } from './hooks';
import type { Point } from './hooks';
import { ItemView } from './ItemView';
import {
  addItem,
  addLayout,
  isPageLocation,
  removeItem,
  sendItem,
  undoManager,
  useItems,
  useLayouts,
} from './store';
import { ItemMenu } from './ItemMenu';
import { thisDevice, useDevices, useKnownDevices } from './sync';

interface Props {
  /** False while something is showing on top; keyboard and paste are ignored. */
  active: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onOpenLayout: (layoutId: string) => void;
  /** Goes back to the Overview. */
  onClose: () => void;
}

const MAX_NEW_IMAGE_WIDTH = 480;

export function Desk({ active, selected, setSelected, onOpenLayout, onClose }: Props) {
  const items = useItems();
  const layouts = useLayouts();
  const known = useKnownDevices();
  const devices = useDevices();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { rootRef, view, setView, toWorld, handlers } = usePanZoom(() => setSelected(null));

  // An item that has left the Desk is no longer selectable on it.
  useEffect(() => {
    if (selected && !items.some((it) => it.id === selected && it.location === 'desk')) setSelected(null);
  }, [items, selected, setSelected]);

  const viewCentre = useCallback((): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [rootRef, toWorld]);

  function addText(at: Point, text = 'Double-click to edit') {
    const w = 260;
    const h = 80;
    setSelected(addItem({ type: 'text', x: at.x - w / 2, y: at.y - h / 2, w, h, text }));
  }

  async function addImages(files: File[], at: Point) {
    let offset = 0;
    for (const file of files) {
      const kind = fileKind(file);
      if (kind) {
        // PDFs and videos go to the file store; the Desk item only points at them.
        setUploading((n) => n + 1);
        try {
          const url = await uploadFile(file);
          const w = kind === 'pdf' ? 420 : 560;
          const h = kind === 'pdf' ? 600 : 360;
          setSelected(
            addItem({ type: kind, url, label: file.name, x: at.x - w / 2 + offset, y: at.y - h / 2 + offset, w, h }),
          );
          offset += 24;
        } catch (err) {
          setUploadError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setUploading((n) => n - 1);
        }
        continue;
      }
      if (!file.type.startsWith('image/')) continue;
      const { src, w, h } = await readImage(file);
      const scale = Math.min(1, MAX_NEW_IMAGE_WIDTH / w);
      const iw = w * scale;
      const ih = h * scale;
      setSelected(
        addItem({ type: 'image', x: at.x - iw / 2 + offset, y: at.y - ih / 2 + offset, w: iw, h: ih, src }),
      );
      offset += 24;
    }
  }

  function deleteSelected() {
    if (selected) removeItem(selected);
    setSelected(null);
  }

  useEditingKeys({
    active: active && !linking,
    onDelete: deleteSelected,
    onEscape: () => setSelected(null),
    onUndo: () => undoManager.undo(),
    onRedo: () => undoManager.redo(),
    onPasteFiles: (files) => void addImages(files, viewCentre()),
    onPasteText: (text) => addText(viewCentre(), text),
  });

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void addImages(files, toWorld(e.clientX, e.clientY));
  }

  const grid = 24 * view.k;
  const deskStyle: CSSProperties = {
    backgroundSize: `${grid}px ${grid}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <>
      <div
        ref={rootRef}
        className="desk"
        style={deskStyle}
        {...handlers}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div
          className="world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, ['--inv' as string]: 1 / view.k }}
        >
          {items.map((it) => {
            if (isPageLocation(it.location)) return null; // lives inside a layout
            if (it.location === 'desk') {
              return (
                <ItemView
                  key={it.id}
                  item={it}
                  selected={it.id === selected}
                  onSelect={setSelected}
                  toWorld={toWorld}
                  layout={it.layoutId ? layouts.find((l) => l.id === it.layoutId) : undefined}
                  onOpen={(item) => item.layoutId && onOpenLayout(item.layoutId)}
                  onMenu={(item, x, y) => setMenu({ id: item.id, x, y })}
                />
              );
            }
            // The item is on a device's Stage. Its marker holds its place; clicking recalls it.
            return (
              <button
                key={it.id}
                className="marker"
                style={{
                  left: it.x,
                  top: it.y,
                  width: it.w,
                  height: it.h,
                  zIndex: it.z,
                  transform: `rotate(${it.rot}deg)`,
                }}
                title="Click to bring this back to the Desk"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => sendItem(it.id, 'desk')}
              >
                <span>on {known.get(it.location)?.name ?? 'another device'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="toolbar">
        <button onClick={onClose}>← Overview</button>
        <span className="brand">Canvas</span>
        <button onClick={() => addText(viewCentre())}>Add text</button>
        <button onClick={() => fileRef.current?.click()} title="Add images, PDFs or videos (MP4, WebM)">
          {uploading ? 'Uploading…' : 'Add file'}
        </button>
        <button
          onClick={() => setLinking(true)}
          title="Show a Google Doc, Sheet or Slides file, or a YouTube or Vimeo video, live on the Desk"
        >
          Add link
        </button>
        <button
          onClick={() => {
            const { itemId, layoutId } = addLayout(viewCentre());
            setSelected(itemId);
            onOpenLayout(layoutId);
          }}
        >
          New layout
        </button>
        <BackgroundButtons item={items.find((it) => it.id === selected)} />
        <button disabled={!selected} onClick={deleteSelected}>
          Delete
        </button>
        <button onClick={() => undoManager.undo()}>Undo</button>
        <button onClick={() => undoManager.redo()}>Redo</button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset view">
          {Math.round(view.k * 100)}%
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
            void addImages(files, viewCentre());
          }}
        />
      </div>

      {menu && items.some((it) => it.id === menu.id) && (
        <ItemMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          options={[
            ...devices.map((d) => ({
              label: d.id === thisDevice.id ? 'Send to my Stage' : `Send to ${d.name}`,
              onSelect: () => sendItem(menu.id, d.id),
            })),
            {
              label: 'Delete',
              divider: true,
              danger: true,
              onSelect: () => {
                removeItem(menu.id);
                setSelected(null);
              },
            },
          ]}
        />
      )}

      {uploadError && (
        <div className="notice" role="alert">
          Could not add {uploadError}
          <button onClick={() => setUploadError(null)}>Dismiss</button>
        </div>
      )}

      {linking && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setLinking(false)}>
          <form
            className="modal"
            role="dialog"
            aria-label="Add a link"
            onSubmit={async (e) => {
              e.preventDefault();
              if (linkBusy) return;
              setLinkBusy(true);
              setLinkError(null);
              try {
                const result = await resolveLink(link);
                const at = viewCentre();
                if (result.kind === 'embed') {
                  const { embed } = result;
                  setSelected(
                    addItem({
                      type: 'embed',
                      url: embed.src,
                      label: embed.label,
                      x: at.x - embed.w / 2,
                      y: at.y - embed.h / 2,
                      w: embed.w,
                      h: embed.h,
                    }),
                  );
                } else {
                  // The site cannot be shown inside another page: a card that opens it instead.
                  const w = 320;
                  const h = result.image ? 300 : 150;
                  setSelected(
                    addItem({
                      type: 'link',
                      url: result.url,
                      label: result.label,
                      text: result.title ?? result.label,
                      src: result.image,
                      x: at.x - w / 2,
                      y: at.y - h / 2,
                      w,
                      h,
                    }),
                  );
                }
                setLink('');
                setLinking(false);
              } catch (err) {
                setLinkError(err instanceof Error ? err.message : String(err));
              } finally {
                setLinkBusy(false);
              }
            }}
          >
            <h2>Add a link</h2>
            <p>
              A link to a Google Doc, Sheet or Slides file, or to a YouTube or Vimeo video, appears live so you can use
              it here. Most other websites do not allow themselves to be shown inside another page; those become a card
              that opens the site in a new tab.
            </p>
            <p className="connect-note">
              For YouTube, use the link to a video or playlist, not the YouTube home page.
            </p>
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
                {linkBusy ? 'Checking the link…' : 'Add to Desk'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
