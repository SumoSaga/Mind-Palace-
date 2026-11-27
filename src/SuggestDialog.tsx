import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { applySuggestion, suggestLayouts } from './suggest';
import type { Box, PageContent, Suggestion } from './suggest';
import type { Item, Layout } from './store';
import { getTheme } from './themes';

interface ClaudeRanking {
  name: string;
  reason: string;
}

/** Shows arrangements for the current page as thumbnails, best fit first; picking one applies it. */
export function SuggestDialog({
  layout,
  pageItems,
  content,
  textSample,
  onClose,
}: {
  layout: Layout;
  pageItems: Item[];
  content: PageContent;
  /** The opening of the page's text, sent to Claude only if the user asks for its ranking. */
  textSample: string;
  onClose: () => void;
}) {
  const builtIn = suggestLayouts(layout, pageItems, content);
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [claude, setClaude] = useState<ClaudeRanking[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paper = getTheme(layout.theme).paper;

  useEffect(() => {
    let cancelled = false;
    fetch('/ai/status')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((s: { available?: boolean }) => !cancelled && setClaudeAvailable(!!s.available))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Claude's order where it gave one; anything it left out keeps its built-in place after.
  let suggestions: Array<Suggestion & { shownReason: string }> = builtIn.map((s) => ({ ...s, shownReason: s.reason }));
  if (claude) {
    const byName = new Map(suggestions.map((s) => [s.name, s]));
    const ranked = claude.flatMap((r) => {
      const s = byName.get(r.name);
      byName.delete(r.name);
      return s ? [{ ...s, shownReason: r.reason }] : [];
    });
    suggestions = [...ranked, ...byName.values()];
  }

  async function askClaude() {
    setAsking(true);
    setError(null);
    try {
      const response = await fetch('/ai/rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: { widthIn: +(layout.w / 72).toFixed(2), heightIn: +(layout.h / 72).toFixed(2), facing: layout.facing },
          theme: getTheme(layout.theme).name,
          textChars: content.textChars,
          startsWithHeading: content.startsWithHeading,
          continuesOnNextPage: content.flowsOn,
          textSample,
          images: pageItems.filter((it) => it.type === 'image').map((it) => ({ aspect: +(it.w / it.h).toFixed(2) })),
          suggestions: builtIn.map((s) => ({ name: s.name, description: s.description })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ranking?: ClaudeRanking[]; error?: string };
      if (!response.ok || !body.ranking) throw new Error(body.error ?? 'Claude could not rank these.');
      setClaude(body.ranking);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }

  const place = (b: Box): CSSProperties => ({
    left: `${(b.x / layout.w) * 100}%`,
    top: `${(b.y / layout.h) * 100}%`,
    width: `${(b.w / layout.w) * 100}%`,
    height: `${(b.h / layout.h) * 100}%`,
  });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Layout suggestions">
        <h2>Layout suggestions for this page</h2>
        {suggestions.length === 0 ? (
          <p>Add some text or an image to this page first, then ask again.</p>
        ) : (
          <>
            <p>
              {claude ? "In Claude's order, best first." : 'Best fit first, judged on the shape of the art, the amount of text and the page width.'}{' '}
              Everything stays editable afterwards, and Undo brings the old layout back.
            </p>
            <div className="suggestions">
              {suggestions.map((s, i) => (
                <button
                  key={s.name}
                  className={`suggestion${i === 0 ? ' best' : ''}`}
                  onClick={() => {
                    applySuggestion(s);
                    onClose();
                  }}
                >
                  <div className="thumb" style={{ aspectRatio: `${layout.w} / ${layout.h}`, background: paper }}>
                    {pageItems.map((it) => {
                      const box = s.boxes.get(it.id);
                      if (!box) return null;
                      return it.type === 'image' ? (
                        <img key={it.id} src={it.src} alt="" style={place(box)} />
                      ) : (
                        <div key={it.id} className="thumb-text" style={place(box)} />
                      );
                    })}
                    {s.split && <div className="thumb-text" style={place(s.split.box)} />}
                  </div>
                  <span className="suggestion-name">
                    {s.name}
                    {i === 0 && <em>Best fit</em>}
                  </span>
                  <span className="suggestion-reason">{s.shownReason}</span>
                </button>
              ))}
            </div>
            {claudeAvailable && !claude && (
              <div className="ask-claude">
                <button disabled={asking} onClick={() => void askClaude()}>
                  {asking ? 'Asking Claude…' : 'Ask Claude to rank these'}
                </button>
                <span>
                  Sends the start of this page's text and a description of each option to Anthropic, and uses a small
                  amount of your API credit each time.
                </span>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
