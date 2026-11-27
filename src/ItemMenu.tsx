import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuOption {
  label: string;
  onSelect: () => void;
  /** Draws a line above this option, to separate groups. */
  divider?: boolean;
  danger?: boolean;
}

/**
 * A small menu opened at a point on the screen, by right-clicking an item or
 * pressing its "more" button. It closes when an option is chosen, when Escape
 * is pressed, or when anything else is clicked.
 */
export function ItemMenu({ x, y, options, onClose }: { x: number; y: number; options: MenuOption[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, options.length]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Listen from the next tick, so the click that opened the menu does not close it.
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('keydown', onKey);
    });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="item-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {options.map((o) => (
        <button
          key={o.label}
          role="menuitem"
          className={`${o.divider ? 'divider' : ''}${o.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose();
            o.onSelect();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
