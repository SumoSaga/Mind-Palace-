import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { BackgroundButtons } from './bg/removeBackground';
import { readImage, useEditingKeys, usePanZoom } from './hooks';
import type { Point } from './hooks';
import { ItemView } from './ItemView';
import {
  addItem,
  addLayout,
  isPageLocation,
  removeItem,
  undoManager,
  updateItem,
  useItems,
  useLayouts,
} from './store';
import { useKnownDevices } from './sync';

interface Props {
  /** False while something is showing on top; keyboard and paste are ignored. */
  active: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onOpenLayout: (layoutId: string) => void;
}

const MAX_NEW_IMAGE_WIDTH = 480;

export function Desk({ active, selected, setSelected, onOpenLayout }: Props) {
  const items = useItems();
  const layouts = useLayouts();
  const known = useKnownDevices();
  const fileRef = useRef<HTMLInputElement>(null);
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
                onClick={() => updateItem(it.id, { location: 'desk' })}
              >
                <span>on {known.get(it.location)?.name ?? 'another device'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="toolbar">
        <span className="brand">Mind Palace</span>
        <button onClick={() => addText(viewCentre())}>Add text</button>
        <button onClick={() => fileRef.current?.click()}>Add image</button>
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
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addImages(files, viewCentre());
          }}
        />
      </div>
    </>
  );
}
