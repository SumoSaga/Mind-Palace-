import { useEffect, useRef, useState } from 'react';
import { loadGoogleScript } from './gdocs/google';
import { signIn } from './session';

/** Shown instead of the app when this installation requires signing in. */
export function SignIn({ clientId }: { clientId: string }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript().then(
      () => {
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            setBusy(true);
            const problem = await signIn(credential);
            if (problem) {
              setError(problem);
              setBusy(false);
            } else {
              window.location.reload();
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', text: 'signin_with' });
      },
      (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load Google sign-in.'),
    );
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div className="sign-in">
      <div className="sign-in-card">
        <h1>Mind Palace</h1>
        <p>Sign in with the Google account that has been given access.</p>
        <div ref={buttonRef} />
        {busy && <p>Signing in…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
