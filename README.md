# Mind Palace

A workspace that spans devices: a shared Desk of documents, images and tools, with a layout tool for tabletop RPG books. See [SPEC.md](SPEC.md) for the settled decisions and build order.

## Run it

```powershell
npm install
npm run dev
```

Then open http://localhost:5173. Other devices on the same Wi-Fi can open the "Network" address the command prints.

## Current state

Step 1 (foundation), first slice:

- Infinite Desk: drag the background to pan, scroll wheel or pinch to zoom.
- Text boxes and images: add, move, resize, rotate (hold Shift to snap), delete, undo and redo.
- Images can be added by button, drag and drop, or paste.
- Each browser keeps its own saved copy of the Desk.
- Live sync: every device that opens the app sees the same Desk and each other's changes as they happen.
- The dock shows which devices are connected. Double-click your own device to rename it.
- Stages: drag an item onto a device in the dock (or select it and click the device) to send it to that device's Stage. A dashed marker holds its place on the Desk; click the marker, or "Back to Desk" on the device, to return it.
- Each device switches between the Desk and its own Stage in the dock. A Stage fills the screen with one item, and shows tabs (phones) or tiles (larger screens) for several.
- A Stage is kept while its device is disconnected; the device shows as "away" and its items stay recallable.

Step 2 (manual layout tool), first slice:

- "New layout" on the Desk creates a layout document and a card for it. Double-click the card to open the editor.
- Page size presets (Letter, A4, trade, digest, poker and tarot cards) or a custom size, margins, and facing pages shown as spreads.
- Text and image frames use the same move, resize and rotate as the Desk. Drag a frame onto another page to move it there.
- Text frames have font, size, colour, alignment, bold and italic.
- "From the Desk" lists the images and text on the Desk; click one to move it onto the current page. "Move to Desk" sends a frame back.
- "Print / PDF" opens the browser's print dialog with pages at their physical size. Choose a printer (set scale to 100%) or "Save as PDF".

- "Remove background" appears when an image is selected, on the Desk and in the editor. It runs on the device (CPU, in a worker), keeps the original, and "Restore background" undoes it. The first use downloads a 176 MB model from Hugging Face, which the browser then caches. Model: ormbg (Apache-2.0), via transformers.js (Apache-2.0). It takes roughly 20 seconds per image on a desktop.

- Fonts: 24 open-licensed font families are bundled with the app (book serifs, fantasy display, modern sans, typewriter), so they look the same on every device and in print. See `src/fonts/`.
- Bleed and crop marks: set a bleed to see its guide (red) around each page; frames that reach it print past the trim edge. With crop marks on, the printed sheet grows to make room for them.

- "Refine" opens the selected image in a brush editor: Erase removes leftover background, Restore paints the original back. Brush size, undo (10 steps), zoom with the scroll wheel. Shortcuts: E, R, [ and ], Ctrl+Z, Esc. See `src/bg/RefineEditor.tsx`.

- Card sheets: "Tile onto Letter/A4 sheets" prints several small pages on each sheet of paper, choosing the paper orientation that fits more, with cut marks in the margin. "Double-sided" treats odd pages as fronts and even pages as backs, printing backs on alternate sheets with the columns mirrored (flip the paper side to side). See `src/PrintView.tsx`.

Not built yet in step 2: uploading your own font files, cropping images inside frames.

Step 3 (linked text frames), first slice:

- A text frame can be continued into a linked frame on the next page ("Continue on next page", or the red + on a frame with more text than fits). The text is then one story flowing through the chain; whatever does not fit a frame carries on into the next.
- "Flow to end" keeps adding pages and linked frames until all the text is placed (up to 300 frames at a time).
- Editing a linked frame edits its portion of the story; the rest reflows when you finish. Resizing, restyling or deleting a linked frame reflows too. Style changes apply to the whole story.
- Pasting long text into the editor makes a frame that fills the margins.
- The flow is worked out by measuring real text in the browser (`src/flow.ts`); it is not stored.

- Mixed styles inside text, written as light markup: start a line with `#`, `##` or `###` for headings, and wrap words in `**bold**` or `*italic*`. The markers are hidden except while editing. A heading is never left alone at the bottom of a frame. This applies to every text item, on the Desk as well. See `src/markup.ts`.

- Google Docs bridge (pull and refresh): "From Google Doc" in the editor loads a doc by its link, converts headings, bold and italic to markup, and places the whole doc or one top-level section on the page, optionally flowing it across pages. Text placed this way remembers its doc and section; "Refresh from doc" re-reads the doc, shows which paragraphs changed, and replaces the text only if you accept. Docs with no heading styles have their short all-bold lines treated as headings. See `src/gdocs/`.

  Setup, once: create a Google Cloud project, enable the Google Docs API, set the OAuth consent screen to External/Testing with yourself as a test user, create an OAuth client ID (Web application) with `http://localhost:5173` as an authorised JavaScript origin, and put `VITE_GOOGLE_CLIENT_ID=<the id>` in a file named `.env.local`. The app only asks for read-only access to Docs, and the access token is kept in memory only.

  Check the converter with `node scripts/test-gdocs.mjs`.

Not built yet in step 3: pushing layout edits back to the doc, merging doc changes with layout edits (a refresh replaces the text), a live Google Doc embedded on the Desk, formatting buttons (markup is typed by hand), separate fonts or colours for headings, paragraph spacing and indents, control of stranded lines at the top or bottom of a frame, columns, and the Google Docs bridge.

Step 4 (layout suggestions and themes), first slice:

- Themes: "Plain", "High fantasy" and "Modern day". A theme sets the body font, a separate heading font and colour, ink colour, body size and paper colour, restyles all the text in the layout, and becomes the default for new frames. Paper colour prints. See `src/themes.ts`.
- "Suggest layouts" shows arrangements for the current page as thumbnails, built from a library of page patterns (art on top, edge to edge, at left or right, below, with one or two text columns). Picking one moves the page's frames; two-column patterns add a linked frame. See `src/suggest.ts`.

Not built yet in step 4: an AI model choosing and ranking the patterns (they are offered in a fixed order), ornaments and textures in themes, cropping images to fill a shape, suggestions across several pages at once.

`npm run dev` starts two things: the app, and a development sync server (`server/sync-server.mjs`) that relays changes between devices. The sync server keeps spaces in memory only.

Not built yet: sign-in, cloud storage, hosting outside the local network.

## Layout

- `src/store.ts` — workspace state (a Yjs document) and item operations.
- `src/sync.ts` — connection to the sync server and the list of connected devices.
- `src/Dock.tsx` — the device dock and Desk/Stage switch.
- `src/Stage.tsx` — a device's Stage.
- `src/App.tsx` — ties the Desk, Stage and dock together.
- `src/Desk.tsx` — the Desk: toolbar, paste and drop, Stage markers.
- `src/LayoutEditor.tsx` — the layout editor and the print view.
- `src/ItemView.tsx` — one item or frame: move, resize, rotate, text editing.
- `src/bg/` — background removal: the worker that runs the model, and the buttons and progress state.
- `src/hooks.ts` — pan and zoom, keyboard shortcuts and image reading, shared by the Desk and the editor.
