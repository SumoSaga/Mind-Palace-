import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Shows one page of a PDF at a time, fitted to the width available, with
 * previous and next controls. Used on the Desk and, larger, on a Stage. The
 * page being read is remembered per device, not shared.
 */
export function PdfView({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError(null);
    setPage(1);
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (doc) => {
        if (!cancelled) setPdf(doc);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'This PDF could not be opened.');
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  // Track the width available, so the page is redrawn sharply when it changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = 0;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 120);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // Draw the current page.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || width < 20) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void pdf.getPage(page).then((p) => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      // Draw at the screen's pixel density, but cap it so huge pages stay manageable.
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: (width / base.width) * density });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${Math.round(viewport.height / density)}px`;
      task = p.render({ canvas, viewport });
      task.promise.catch(() => {
        /* cancelled by a newer draw */
      });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width]);

  const count = pdf?.numPages ?? 0;

  return (
    <div className="pdf">
      <div className="pdf-scroll" ref={scrollRef}>
        {error ? <p className="pdf-message">{error}</p> : !pdf ? <p className="pdf-message">Opening…</p> : null}
        <canvas ref={canvasRef} hidden={!pdf || !!error} />
      </div>
      {pdf && (
        <div className="pdf-bar">
          <button disabled={page <= 1} onClick={() => setPage((n) => n - 1)} aria-label="Previous page">
            ‹
          </button>
          <span>
            Page {page} of {count}
          </span>
          <button disabled={page >= count} onClick={() => setPage((n) => n + 1)} aria-label="Next page">
            ›
          </button>
        </div>
      )}
    </div>
  );
}
