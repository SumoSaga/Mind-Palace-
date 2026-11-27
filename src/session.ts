/**
 * Who is signed in, as the server sees it. Asked once when the app starts,
 * before anything connects to the workspace.
 */
export interface Session {
  /** True when this installation requires signing in. */
  required: boolean;
  /** The Google OAuth client ID the server is set up with, if any. */
  clientId: string;
  user: { email: string; name: string } | null;
  /**
   * Set when devices connect by pairing (the home setup, without Google
   * sign-in): whether this device is allowed in yet.
   */
  pairing?: { paired: boolean } | null;
}

let current: Session = { required: false, clientId: '', user: null };

/** Hands in a pairing code for this device. Returns an error message, or null on success. */
export async function pairDevice(code: string): Promise<string | null> {
  try {
    const response = await fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? 'That code did not work.';
  } catch {
    return 'Could not reach Mind Palace. Check this device is on the same Wi-Fi.';
  }
}

export async function loadSession(): Promise<Session> {
  try {
    const response = await fetch('/auth/me', { cache: 'no-store' });
    if (response.ok) current = (await response.json()) as Session;
  } catch {
    // No server to ask (or an older one): carry on without sign-in.
  }
  return current;
}

export const getSession = () => current;

/** Exchanges a Google sign-in for a session. Returns an error message, or null on success. */
export async function signIn(credential: string): Promise<string | null> {
  try {
    const response = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? 'Sign-in failed.';
  } catch {
    return 'Could not reach the server.';
  }
}

export async function signOut() {
  await fetch('/auth/signout', { method: 'POST' }).catch(() => {});
  window.location.reload();
}
