import { useState } from 'react';
import type { Story, StorySource } from '../store';
import { summariseChanges } from './convert';
import type { ConvertedDoc } from './convert';
import { isGoogleConfigured, loadGoogleDoc } from './google';

/** Value of the section picker meaning "the whole document". */
const WHOLE = '\u0000whole';

function sectionText(doc: ConvertedDoc, section: string | null): string | null {
  if (section === null) return doc.text;
  return doc.sections.find((s) => s.title === section)?.text ?? null;
}

function SetupHelp() {
  return (
    <>
      <p>
        Pulling text from Google Docs needs a one-time setup that only you can do, because it is tied to your Google
        account:
      </p>
      <ol>
        <li>
          In the Google Cloud console, create a project and enable the <b>Google Docs API</b>.
        </li>
        <li>
          Set up the OAuth consent screen as <b>External</b>, leave it in <b>Testing</b>, and add your own Google
          address as a test user.
        </li>
        <li>
          Create an <b>OAuth client ID</b> of type <b>Web application</b>, with <code>http://localhost:5173</code> as an
          authorised JavaScript origin.
        </li>
        <li>
          In the project folder, create a file named <code>.env.local</code> containing{' '}
          <code>VITE_GOOGLE_CLIENT_ID=your-client-id</code>, then restart the app.
        </li>
      </ol>
      <p>The client ID is not a password, and that file is never uploaded to GitHub.</p>
    </>
  );
}

/** Choose a Google Doc and a section of it to place on the page. */
export function PullDialog({
  onClose,
  onPlace,
}: {
  onClose: () => void;
  onPlace: (text: string, source: StorySource, flowAcrossPages: boolean) => void;
}) {
  const [link, setLink] = useState('');
  const [doc, setDoc] = useState<(ConvertedDoc & { docId: string }) | null>(null);
  const [section, setSection] = useState(WHOLE);
  const [flowOn, setFlowOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadGoogleDoc(link);
      setDoc(loaded);
      setSection(WHOLE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function place() {
    if (!doc) return;
    const chosen = section === WHOLE ? null : section;
    const text = sectionText(doc, chosen);
    if (!text) return;
    onPlace(
      text,
      { kind: 'gdoc', docId: doc.docId, docTitle: doc.title, section: chosen, pulledAt: Date.now(), pulledText: text },
      flowOn,
    );
    onClose();
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Pull text from a Google Doc">
        <h2>Pull text from a Google Doc</h2>
        {!isGoogleConfigured() ? (
          <SetupHelp />
        ) : (
          <>
            <label className="field">
              Link to the document
              <input
                autoFocus
                value={link}
                placeholder="https://docs.google.com/document/d/…"
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && link.trim() && void load()}
              />
            </label>
            <button disabled={busy || !link.trim()} onClick={() => void load()}>
              {busy ? 'Loading…' : doc ? 'Load again' : 'Sign in to Google and load'}
            </button>
            {error && <p className="error">{error}</p>}
            {doc && (
              <>
                <p>
                  Loaded <b>{doc.title}</b>.
                </p>
                <label className="field">
                  What to place
                  <select value={section} onChange={(e) => setSection(e.target.value)}>
                    <option value={WHOLE}>The whole document</option>
                    {doc.sections.map((s) => (
                      <option key={s.title} value={s.title}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={flowOn} onChange={(e) => setFlowOn(e.target.checked)} />
                  Add pages until all the text is placed
                </label>
              </>
            )}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{isGoogleConfigured() ? 'Cancel' : 'Close'}</button>
          {doc && (
            <button className="primary" onClick={place}>
              Place on page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type RefreshState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'same' }
  | { step: 'changed'; text: string; added: string[]; removed: string[] }
  | { step: 'error'; message: string };

/** Check the Google Doc a story came from, and show what changed before taking it. */
export function RefreshDialog({
  story,
  onClose,
  onAccept,
}: {
  story: Story;
  onClose: () => void;
  onAccept: (text: string) => void;
}) {
  const source = story.source!;
  const [state, setState] = useState<RefreshState>({ step: 'idle' });
  const editedHere = story.text !== source.pulledText;

  async function check() {
    setState({ step: 'loading' });
    try {
      const doc = await loadGoogleDoc(source.docId);
      const text = sectionText(doc, source.section);
      if (text === null) {
        setState({
          step: 'error',
          message: `The section "${source.section}" is no longer in the document. Its heading may have been renamed.`,
        });
      } else if (text === source.pulledText) {
        setState({ step: 'same' });
      } else {
        setState({ step: 'changed', text, ...summariseChanges(source.pulledText, text) });
      }
    } catch (err) {
      setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Refresh from Google Doc">
        <h2>Refresh from Google Doc</h2>
        <p>
          This text came from <b>{source.docTitle}</b>
          {source.section ? (
            <>
              , section <b>{source.section}</b>
            </>
          ) : null}
          , pulled on {new Date(source.pulledAt).toLocaleString()}.
        </p>
        {state.step === 'idle' && (
          <button onClick={() => void check()}>
            {isGoogleConfigured() ? 'Check the document for changes' : 'Google is not set up'}
          </button>
        )}
        {state.step === 'loading' && <p>Checking…</p>}
        {state.step === 'same' && <p>The document has not changed since this text was pulled.</p>}
        {state.step === 'error' && <p className="error">{state.message}</p>}
        {state.step === 'changed' && (
          <>
            <p>
              The document has changed: {state.added.length} new or changed{' '}
              {state.added.length === 1 ? 'paragraph' : 'paragraphs'}, {state.removed.length} removed or replaced.
            </p>
            {state.added.length > 0 && (
              <ul className="changes">
                {state.added.slice(0, 6).map((p, i) => (
                  <li key={i}>{p.length > 140 ? `${p.slice(0, 140)}…` : p}</li>
                ))}
                {state.added.length > 6 && <li>…and {state.added.length - 6} more</li>}
              </ul>
            )}
            {editedHere && (
              <p className="error">
                You have edited this text in the layout since it was pulled. Taking the document's version replaces
                those edits. Font, size and frame positions are kept.
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{state.step === 'changed' ? 'Keep the layout text' : 'Close'}</button>
          {state.step === 'changed' && (
            <button
              className="primary"
              onClick={() => {
                onAccept(state.text);
                onClose();
              }}
            >
              Use the document's text
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
