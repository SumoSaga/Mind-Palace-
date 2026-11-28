import { useCallback, useEffect, useState } from 'react';
import { RefineEditor, useRefineId } from './bg/RefineEditor';
import { Desk } from './Desk';
import { DeviceDialog } from './DeviceDialog';
import { Dock } from './Dock';
import { LayoutEditor } from './LayoutEditor';
import { Library } from './library/Library';
import { onOpenFolder } from './library/folders';
import type { FolderRef } from './library/folders';
import { Notices } from './notice';
import { Overview } from './Overview';
import { Stage } from './Stage';
import { thisDevice } from './sync';

/**
 * The three main views:
 *   overview - every device and what is on it
 *   stage    - this device's own surface
 *   canvas   - the shared canvas for things not on any device
 */
export type Mode = 'overview' | 'stage' | 'canvas';

export function App() {
  // Phones and TVs open on their own Stage; larger devices open on the Overview.
  const [mode, setMode] = useState<Mode>(
    thisDevice.kind === 'phone' || thisDevice.kind === 'tv' ? 'stage' : 'overview',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [openLayout, setOpenLayout] = useState<string | null>(null);
  const closeLayout = useCallback(() => setOpenLayout(null), []);
  const refineId = useRefineId();
  const [naming, setNaming] = useState(!thisDevice.named);
  const busy = !!openLayout || !!refineId || naming;
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** A Mind Palace folder the Library was opened at, by opening its card. */
  const [libraryFolder, setLibraryFolder] = useState<FolderRef | null>(null);
  useEffect(
    () =>
      onOpenFolder((folder) => {
        setLibraryFolder(folder);
        setLibraryOpen(true);
      }),
    [],
  );

  function changeMode(next: Mode) {
    setSelected(null);
    setMode(next);
  }

  return (
    <div className="app">
      {/*
        The Stage and the canvas stay loaded while another view is showing, only
        hidden. Unloading them would stop any video or music playing on them.
      */}
      <div className={`view${mode === 'canvas' ? '' : ' hidden'}`}>
        <Desk
          active={mode === 'canvas' && !busy}
          selected={selected}
          setSelected={setSelected}
          onOpenLayout={setOpenLayout}
          onClose={() => changeMode('overview')}
        />
      </div>
      <div className={`view${mode === 'stage' ? '' : ' hidden'}`}>
        <Stage active={mode === 'stage' && !busy} onOpenOverview={() => changeMode('overview')} onOpenLayout={setOpenLayout} />
      </div>
      {mode === 'overview' && (
        <Overview onOpenLayout={setOpenLayout} onOpenCanvas={() => changeMode('canvas')} onOpenStage={() => changeMode('stage')} />
      )}
      <Dock
        mode={mode}
        setMode={changeMode}
        selected={selected}
        onSent={() => setSelected(null)}
        libraryOpen={libraryOpen}
        onToggleLibrary={() => {
          setLibraryFolder(null);
          setLibraryOpen((open) => !open);
        }}
      />
      {libraryOpen && !busy && (
        <Library
          key={libraryFolder?.id ?? 'drive'}
          // On your own Stage, new things go to this device; otherwise to "Not on a device".
          defaultLocation={mode === 'stage' ? thisDevice.id : 'desk'}
          startFolder={libraryFolder ?? undefined}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      <Notices />
      {openLayout && <LayoutEditor key={openLayout} layoutId={openLayout} onClose={closeLayout} />}
      {refineId && <RefineEditor key={refineId} itemId={refineId} />}
      {/* The first time a device opens Mind Palace, it is asked for a name and type. */}
      {naming && <DeviceDialog firstTime onClose={() => setNaming(false)} />}
    </div>
  );
}
