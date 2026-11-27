import type { CSSProperties } from 'react';
import { applySuggestion, suggestLayouts } from './suggest';
import type { Box } from './suggest';
import type { Item, Layout } from './store';
import { getTheme } from './themes';

/** Shows arrangements for the current page as thumbnails; picking one applies it. */
export function SuggestDialog({
  layout,
  pageItems,
  onClose,
}: {
  layout: Layout;
  pageItems: Item[];
  onClose: () => void;
}) {
  const suggestions = suggestLayouts(layout, pageItems);
  const paper = getTheme(layout.theme).paper;
  const place = (b: Box): CSSProperties => ({
    left: `${(b.x / layout.w) * 100}%`,
    top: `${(b.y / layout.h) * 100}%`,
    width: `${(b.w / layout.w) * 100}%`,
    height: `${(b.h / layout.h) * 100}%`,
  });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Layout suggestions">
        <h2>Layout suggestions for this page</h2>
        {suggestions.length === 0 ? (
          <p>Add some text or an image to this page first, then ask again.</p>
        ) : (
          <>
            <p>Pick an arrangement. Everything stays editable afterwards, and Undo brings the old layout back.</p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  className="suggestion"
                  onClick={() => {
                    applySuggestion(s);
                    onClose();
                  }}
                >
                  <div className="thumb" style={{ aspectRatio: `${layout.w} / ${layout.h}`, background: paper }}>
                    {pageItems.map((it) => {
                      const box = s.boxes.get(it.id);
                      if (!box) return null;
                      return it.type === 'image' ? (
                        <img key={it.id} src={it.src} alt="" style={place(box)} />
                      ) : (
                        <div key={it.id} className="thumb-text" style={place(box)} />
                      );
                    })}
                    {s.split && <div className="thumb-text" style={place(s.split.box)} />}
                  </div>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
