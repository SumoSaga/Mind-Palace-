import { useState } from 'react';
import { pairDevice } from './session';

/** Shown on a device that has not been connected yet: enter the code from a connected device. */
export function PairScreen({ initialError }: { initialError?: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const digits = code.replace(/\D/g, '');

  async function submit() {
    if (digits.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const problem = await pairDevice(digits);
    if (problem) {
      setError(problem);
      setBusy(false);
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="sign-in">
      <form
        className="sign-in-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>Mind Palace</h1>
        <p>
          To connect this device, open Mind Palace on a device that is already connected, choose{' '}
          <b>Connect a device</b>, and enter the 6-digit code shown there.
        </p>
        <input
          className="code-input"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          placeholder="000 000"
          maxLength={7}
          value={digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)}` : digits}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" disabled={digits.length !== 6 || busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
