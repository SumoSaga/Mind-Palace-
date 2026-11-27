import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSession, pairDevice } from './session';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

// Ask the server whether this device may come in before loading the app,
// because the app connects to the workspace as soon as it loads.
let session = await loadSession();

// A link from a scanned QR code carries a pairing code. Use it, and take it
// out of the address bar so it is not kept in history or shared by accident.
const params = new URLSearchParams(window.location.search);
const scannedCode = params.get('pair');
let pairError: string | undefined;
if (scannedCode !== null) {
  params.delete('pair');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  if (session.pairing && !session.pairing.paired) {
    const problem = await pairDevice(scannedCode);
    if (problem) pairError = problem;
    else session = await loadSession();
  }
}

if (session.required && !session.user) {
  const { SignIn } = await import('./SignIn');
  root.render(
    <StrictMode>
      <SignIn clientId={session.clientId} />
    </StrictMode>,
  );
} else if (session.pairing && !session.pairing.paired) {
  const { PairScreen } = await import('./PairScreen');
  root.render(
    <StrictMode>
      <PairScreen initialError={pairError} />
    </StrictMode>,
  );
} else {
  const { App } = await import('./App');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
