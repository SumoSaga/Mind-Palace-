import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { BackgroundButtons } from './bg/removeBackground';
import { AddBar, onEmptySurface } from './AddBar';
import type { AddMenuRequest } from './AddBar';
import { fileKind, uploadFile } from './files';
import { readImage, useEditingKeys, usePanZoom } from './hooks';
import type { Point } from './hooks';
import { ItemView } from './ItemView';
import {
  addItem,
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
  const [addAt, setAddAt] = useState<AddMenuRequest | null>(null);
  const [, setUploading] = useState(0);
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
    active,
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
        onContextMenu={(e) => {
          // Right-click on empty space: the add menu, placing things where it was clicked.
          if (!onEmptySurface(e.target)) return;
          e.preventDefault();
          setAddAt({ x: e.clientX, y: e.clientY, at: toWorld(e.clientX, e.clientY) });
        }}
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
        <button onClick={onClose} title="Back to the Overview">
          ← Overview
        </button>
        <span className="brand">Canvas</span>
        <AddBar
          location="desk"
          place={viewCentre}
          onAdded={setSelected}
          onOpenLayout={onOpenLayout}
          request={addAt}
          onRequestDone={() => setAddAt(null)}
        />
        <BackgroundButtons item={items.find((it) => it.id === selected)} />
        <button disabled={!selected} onClick={deleteSelected}>
          Delete
        </button>
        <button onClick={() => undoManager.undo()} title="Undo" aria-label="Undo">
          ↶
        </button>
        <button onClick={() => undoManager.redo()} title="Redo" aria-label="Redo">
          ↷
        </button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset view">
          {Math.round(view.k * 100)}%
        </button>
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

    </>
  );
}
