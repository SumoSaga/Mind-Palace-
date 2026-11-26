import { useCallback, useState } from 'react';
import { Desk } from './Desk';
import { Dock } from './Dock';
import { LayoutEditor } from './LayoutEditor';
import { Stage } from './Stage';
import { thisDevice } from './sync';

export type Mode = 'desk' | 'stage';

export function App() {
  // Phones and TVs open on their own Stage; larger devices open on the Desk.
  const [mode, setMode] = useState<Mode>(
    thisDevice.kind === 'phone' || thisDevice.kind === 'tv' ? 'stage' : 'desk',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [openLayout, setOpenLayout] = useState<string | null>(null);
  const closeLayout = useCallback(() => setOpenLayout(null), []);

  function changeMode(next: Mode) {
    setSelected(null);
    setMode(next);
  }

  return (
    <div className="app">
      <Desk
        active={mode === 'desk' && !openLayout}
        selected={selected}
        setSelected={setSelected}
        onOpenLayout={setOpenLayout}
      />
      {mode === 'stage' && <Stage onOpenDesk={() => changeMode('desk')} onOpenLayout={setOpenLayout} />}
      <Dock mode={mode} setMode={changeMode} selected={selected} onSent={() => setSelected(null)} />
      {openLayout && <LayoutEditor key={openLayout} layoutId={openLayout} onClose={closeLayout} />}
    </div>
  );
}
