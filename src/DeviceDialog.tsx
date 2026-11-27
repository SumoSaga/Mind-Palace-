import { useState } from 'react';
import { describeThisDevice, DEVICE_KINDS, thisDevice } from './sync';
import type { DeviceKind } from './sync';

/**
 * Name this device and say what kind it is. Shown the first time a device
 * opens Mind Palace, and again whenever its entry in the dock is clicked.
 */
export function DeviceDialog({ firstTime, onClose }: { firstTime: boolean; onClose: () => void }) {
  // A device that has never been named starts with an empty box, not "Phone".
  const [name, setName] = useState(thisDevice.named ? thisDevice.name : '');
  const [kind, setKind] = useState<DeviceKind>(thisDevice.kind === 'computer' ? 'laptop' : thisDevice.kind);

  function save() {
    describeThisDevice(name, kind);
    onClose();
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => !firstTime && e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-label="Name this device"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{firstTime ? 'Name this device' : 'This device'}</h2>
        <p>
          {firstTime
            ? 'Give this device a name so you can tell your devices apart when sending things between them.'
            : 'This is how this device appears to your other devices.'}
        </p>
        <label className="field">
          Name
          <input
            autoFocus
            value={name}
            maxLength={30}
            placeholder={'For example "Hayden\'s phone" or "Studio PC"'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          What kind of device is it?
          <div className="kind-choices" role="radiogroup" aria-label="Kind of device">
            {DEVICE_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                className={kind === k.kind ? 'chosen' : ''}
                onClick={() => setKind(k.kind)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          {!firstTime && (
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="primary">
            {firstTime ? 'Continue' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
