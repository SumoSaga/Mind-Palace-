import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { isDriveConnected, isGoogleConfigured } from '../gdocs/google';
import { driveKind, KIND_WORD } from './classify';
import type { DriveFile, LibraryTab } from './classify';
import { addFromDrive, listDrive } from './drive';

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'drive', label: 'My Drive' },
  { id: 'docs', label: 'Docs' },
  { id: 'images', label: 'Images' },
  { id: 'models', label: '3D' },
];

const HOLD_MS = 220;

interface Props {
  /** Where a clicked file goes: 'desk', or this device's id when its Stage is showing. */
  defaultLocation: string;
  onClose: () => void;
}

/**
 * The Library: a panel for browsing Google Drive and bringing files into the
 * workspace. Click a file to add it, or drag it out of the panel and drop it;
 * dropping on a device in the Overview sends it straight to that device.
 */
export function Library({ defaultLocation, onClose }: Props) {
  const [connected, setConnected] = useState(isDriveConnected());
  const [tab, setTab] = useState<LibraryTab>('recent');
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'My Drive' }]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // the search actually applied, after a pause in typing
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(0);
  const [drag, setDrag] = useState<{ file: DriveFile; x: number; y: number; over: string | null } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const request = useRef(0);
  useEffect(() => () => cleanup.current?.(), []);

  const folderId = path[path.length - 1].id;

  // Apply the search a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (pageToken?: string) => {
      const mine = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const page = await listDrive(tab, folderId, query, pageToken);
        if (mine !== request.current) return; // a newer request has replaced this one
        setFiles((old) => (pageToken ? [...old, ...page.files] : page.files));
        setNext(page.nextPageToken);
        setConnected(true);
      } catch (err) {
        if (mine !== request.current) return;
        setError(err instanceof Error ? err.message : String(err));
        if (!pageToken) setFiles([]);
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [tab, folderId, query],
  );

  // Reload whenever the tab, folder or search changes, once Drive is connected.
  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  async function add(file: DriveFile, location: string) {
    if (driveKind(file) === 'folder') {
      setTab('drive');
      setSearch('');
      setQuery('');
      setPath((p) => [...p, { id: file.id, name: file.name }]);
      return;
    }
    setAdding((s) => new Set(s).add(file.id));
    setError(null);
    try {
      // Each new thing lands a little down and right of the last.
      await addFromDrive(file, location, { x: 240 + (added % 8) * 28, y: 240 + (added % 8) * 28 });
      setAdded((n) => n + 1);
    } catch (err) {
      setError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAdding((s) => {
        const copy = new Set(s);
        copy.delete(file.id);
        return copy;
      });
    }
  }

  /** The device panel (in the Overview) under a point, if any. */
  const placeAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-place]') as HTMLElement | null)?.dataset.place ?? null;
  const overLibrary = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('.library');

  /**
   * A press on a file: a click adds it; a drag carries it out of the panel.
   * With a finger, a short hold starts the drag, so a swipe still scrolls.
   */
  function onTilePointerDown(e: ReactPointerEvent<HTMLElement>, file: DriveFile) {
    if (e.button !== 0) return;
    cleanup.current?.();
    const start = { x: e.clientX, y: e.clientY };
    const pointerId = e.pointerId;
    const touch = e.pointerType === 'touch';
    let lifted = false;
    let cancelled = false;
    let timer = 0;

    const lift = (x: number, y: number) => {
      lifted = true;
      setDrag({ file, x, y, over: placeAt(x, y) });
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
      if (!lifted) {
        if (touch) {
          if (moved > 10) {
            cancelled = true; // a swipe: let the list scroll, and do not treat it as a click
            finish();
          }
          return;
        }
        if (moved < 5) return;
        lift(ev.clientX, ev.clientY);
      }
      setDrag((d) => d && { ...d, x: ev.clientX, y: ev.clientY, over: placeAt(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const wasLifted = lifted;
      finish();
      if (cancelled) return;
      if (!wasLifted) void add(file, defaultLocation); // a plain click or tap
      else if (!overLibrary(ev.clientX, ev.clientY)) void add(file, placeAt(ev.clientX, ev.clientY) ?? defaultLocation);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cancelled = true;
      finish();
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (lifted && ev.cancelable) ev.preventDefault();
    };
    function finish() {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      cleanup.current = null;
      setDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    cleanup.current = finish;
    if (touch) timer = window.setTimeout(() => lift(start.x, start.y), HOLD_MS);
    else e.preventDefault();
  }

  const picture = (file: DriveFile) =>
    file.thumbnailLink ? (
      <img src={file.thumbnailLink} alt="" draggable={false} referrerPolicy="no-referrer" />
    ) : (
      <span className="lib-icon">{KIND_WORD[driveKind(file)]}</span>
    );

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  return (
    <aside className="library" aria-label="Library">
      <header>
        <strong>Library</strong>
        <span className="lib-source">Google Drive</span>
        <button onClick={onClose} aria-label="Close the library">
          ×
        </button>
      </header>

      {!isGoogleConfigured() ? (
        <p className="lib-note">Google is not set up for this app yet. Follow the steps under "From Google Doc" in a layout first.</p>
      ) : !local ? (
        <p className="lib-note">
          Google only allows sign-in on the computer running Mind Palace, at <b>localhost</b>. Open the Library there,
          then send what you add to this device.
        </p>
      ) : !connected ? (
        <div className="lib-connect">
          <p>Browse your Google Drive and bring in docs, images, PDFs, videos and 3D models.</p>
          <button className="primary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Connecting…' : 'Connect Google Drive'}
          </button>
          <p className="lib-small">Mind Palace asks for read-only access. It cannot change or delete anything in your Drive.</p>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="lib-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="lib-search"
            type="search"
            value={search}
            placeholder="Search by name"
            aria-label="Search Google Drive by name"
            onChange={(e) => setSearch(e.target.value)}
          />
          {tab === 'drive' && !query.trim() && (
            <div className="lib-path">
              {path.map((p, i) => (
                <button key={p.id} disabled={i === path.length - 1} onClick={() => setPath(path.slice(0, i + 1))}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="lib-list">
            {files.map((file) => {
              const kind = driveKind(file);
              return (
                <button
                  key={file.id}
                  className={`lib-tile${adding.has(file.id) ? ' busy' : ''}`}
                  onPointerDown={(e) => onTilePointerDown(e, file)}
                  onContextMenu={(e) => e.preventDefault()}
                  title={kind === 'folder' ? `Open the folder ${file.name}` : `Click to add ${file.name}, or drag it out`}
                >
                  <span className={`lib-thumb lib-${kind}`}>{picture(file)}</span>
                  <span className="lib-name">{file.name}</span>
                  <span className="lib-kind">{adding.has(file.id) ? 'Adding…' : KIND_WORD[kind]}</span>
                </button>
              );
            })}
            {!loading && files.length === 0 && !error && <p className="lib-note">Nothing found here.</p>}
            {loading && <p className="lib-note">Loading…</p>}
            {next && !loading && (
              <button className="lib-more" onClick={() => void load(next)}>
                Show more
              </button>
            )}
          </div>
        </>
      )}

      {drag && (
        <div className="lib-ghost" style={{ left: drag.x, top: drag.y }}>
          <span className={`lib-thumb lib-${driveKind(drag.file)}`}>{picture(drag.file)}</span>
          <span className="lib-name">{drag.file.name}</span>
        </div>
      )}
    </aside>
  );
}
