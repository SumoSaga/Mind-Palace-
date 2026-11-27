import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSession } from './session';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

// Ask the server who is signed in before loading the app, because the app
// connects to the workspace as soon as it loads.
const session = await loadSession();

if (session.required && !session.user) {
  const { SignIn } = await import('./SignIn');
  root.render(
    <StrictMode>
      <SignIn clientId={session.clientId} />
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
