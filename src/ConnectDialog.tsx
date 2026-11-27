import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface PairInfo {
  code: string;
  expiresAt: number;
  /** This computer's addresses on the local network. */
  addresses: string[];
}

/**
 * Shown on a connected device to bring another one in: a QR code to scan with
 * a phone or tablet, and the address and 6-digit code to type on anything else.
 */
export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Fetch the code, and again whenever it has expired.
  const expired = info ? info.expiresAt <= now : false;
  useEffect(() => {
    if (info && !expired) return;
    let cancelled = false;
    fetch('/pair/code', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not get a code.');
        return (await r.json()) as PairInfo;
      })
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setError(null);
        // If this page was itself opened by network address, offer that one first.
        setAddress((a) => a ?? (next.addresses.includes(location.hostname) ? location.hostname : (next.addresses[0] ?? null)));
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [info, expired]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // The address other devices open: this computer's network address, on the port this page uses.
  const url = address ? `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}` : null;

  // The QR code carries the address and the code, so scanning it connects in one step.
  useEffect(() => {
    if (!url || !info) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(`${url}/?pair=${info.code}`, { margin: 2, width: 440, errorCorrectionLevel: 'M' }).then(
      (dataUrl) => !cancelled && setQr(dataUrl),
      () => !cancelled && setQr(null),
    );
    return () => {
      cancelled = true;
    };
  }, [url, info]);

  const secondsLeft = info ? Math.max(0, Math.ceil((info.expiresAt - now) / 1000)) : 0;
  const code = info?.code ?? '';

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Connect a device">
        <h2>Connect a device</h2>
        {error && <p className="error">{error}</p>}
        {info && !url && (
          <p className="error">
            This computer does not seem to be on a network, so other devices cannot reach it. Connect it to your Wi-Fi
            and try again.
          </p>
        )}
        {info && url && (
          <div className="connect">
            <div className="connect-qr">
              {qr ? <img src={qr} alt="QR code that opens Mind Palace on another device" /> : <span>Making QR code…</span>}
            </div>
            <div className="connect-steps">
              <p>
                <b>Phone or tablet:</b> point the camera at the QR code and open the link. It connects straight away.
              </p>
              <p>
                <b>Any other device:</b> open this address in a browser, then enter the code.
              </p>
              <div className="connect-address">{url.replace(/^https?:\/\//, '')}</div>
              <div className="connect-code" aria-label={`Code ${code.split('').join(' ')}`}>
                {code.slice(0, 3)} {code.slice(3)}
              </div>
              <p className="connect-note">
                The code changes in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}. A device
                only needs it once; after that it is remembered.
              </p>
              {info.addresses.length > 1 && (
                <label className="field">
                  This computer has more than one network address. If the first does not work, try another:
                  <select value={address ?? ''} onChange={(e) => setAddress(e.target.value)}>
                    {info.addresses.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}
        <p className="connect-note">
          The other device must be on the same Wi-Fi as this computer, and this computer must be running Mind Palace.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
