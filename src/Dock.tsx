import type { Mode } from './App';
import { getSession, signOut } from './session';
import { isPageLocation, updateItem, useItems } from './store';
import { renameThisDevice, thisDevice, useConnected, useDevices, useKnownDevices } from './sync';

interface Props {
  mode: Mode;
  setMode: (mode: Mode) => void;
  /** The item selected on the Desk, if any. Clicking a device sends it there. */
  selected: string | null;
  onSent: () => void;
}

/** Returns the id of the dock device under a screen position, if any. */
export function deviceAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY)?.closest('[data-device-id]');
  return (el as HTMLElement | null)?.dataset.deviceId ?? null;
}

/** Highlights one dock device as the drop target (or none). */
export function highlightDevice(id: string | null) {
  document.querySelectorAll<HTMLElement>('[data-device-id]').forEach((el) => {
    el.classList.toggle('drop-target', id !== null && el.dataset.deviceId === id);
  });
}

/**
 * Connection state, the Desk/Stage switch, and the devices in this space.
 * Devices are drop targets: drag an item onto one to send it to that Stage.
 */
export function Dock({ mode, setMode, selected, onSent }: Props) {
  const connected = useConnected();
  const online = useDevices();
  const known = useKnownDevices();
  const items = useItems();
  const user = getSession().user;

  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.location !== 'desk' && !isPageLocation(it.location)) counts.set(it.location, (counts.get(it.location) ?? 0) + 1);
  }

  // Connected devices, then disconnected ones that still hold items.
  const onlineIds = new Set(online.map((d) => d.id));
  const offline = [...counts.keys()]
    .filter((id) => !onlineIds.has(id))
    .map((id) => known.get(id) ?? { id, name: 'Unknown device', kind: 'computer' as const });
  const mine = counts.get(thisDevice.id) ?? 0;

  function rename() {
    const name = window.prompt('Name this device', thisDevice.name);
    if (name) renameThisDevice(name);
  }

  return (
    <div className="dock">
      <span className={`status ${connected ? 'on' : 'off'}`} title={connected ? 'Connected' : 'Not connected'}>
        {connected ? 'Live' : 'Offline'}
      </span>

      <div className="views">
        <button className={mode === 'desk' ? 'active' : ''} onClick={() => setMode('desk')}>
          Desk
        </button>
        <button className={mode === 'stage' ? 'active' : ''} onClick={() => setMode('stage')}>
          My Stage{mine > 0 && <span className="count">{mine}</span>}
        </button>
      </div>

      {[...online, ...offline].map((d) => {
        const isMine = d.id === thisDevice.id;
        const count = counts.get(d.id) ?? 0;
        return (
          <button
            key={d.id}
            data-device-id={d.id}
            className={`device${isMine ? ' mine' : ''}${onlineIds.has(d.id) ? '' : ' away'}`}
            title={
              (isMine ? 'This device. Double-click to rename. ' : '') +
              `Drag an item here, or select one and click, to send it to ${d.name}.`
            }
            onClick={() => {
              if (!selected) return;
              updateItem(selected, { location: d.id });
              onSent();
            }}
            onDoubleClick={isMine ? rename : undefined}
          >
            <span className="kind">{d.kind}</span>
            {d.name}
            {count > 0 && <span className="count">{count}</span>}
            {isMine && <span className="you">this device</span>}
            {!onlineIds.has(d.id) && <span className="you">away</span>}
          </button>
        );
      })}

      {user && (
        <button className="device" onClick={() => void signOut()} title={`Signed in as ${user.email}`}>
          Sign out
        </button>
      )}
    </div>
  );
}
