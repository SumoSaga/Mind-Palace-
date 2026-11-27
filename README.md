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

- Data-driven cards: "Card data" turns a layout into a template. Paste rows copied from Google Sheets or Excel, or choose a CSV file; each row makes one card. Text frames use `{{Column}}` placeholders, an image can take its picture from a column of image links, and a `Count` column (or Qty, Quantity, Copies) sets copies per card. The editor previews one row at a time; printing makes every card, and works with sheet tiling and double-sided. See `src/cards/`; check the parser with `node scripts/test-cards.mjs`.
- Print-service presets in the page-size menu: The Game Crafter card sizes and DriveThruRPG book sizes, each also setting that service's bleed and safe margin (specifications checked 27 November 2026; sources are noted in `src/LayoutEditor.tsx`).
- Books (facing pages) have no bleed on the binding edge, on screen or in print, which is how book printers ask for files.

Not built yet in step 2: uploading your own font files, cropping images inside frames, exporting cards as PNG images (which The Game Crafter requires), CMYK or PDF/X output (which DriveThruRPG requires), reading card data straight from a Google Sheet.

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

- Push to doc: text pulled from a Google Doc can be written back. "Push to doc" replaces that section (or the whole doc) with the layout's text, restoring headings, bold and italic. It asks Google for edit access only at that point. It refuses, changing nothing, if the doc has changed since the text was pulled or if that part of the doc contains lists, tables or images. The planning logic is in `src/gdocs/push.ts`; check it with `node scripts/test-gdocs-push.mjs`.
- Links on the Desk: "Add link" shows a Google Doc, Sheet or Slides file, or a YouTube or Vimeo video, live in a frame that moves and resizes like any item and can be sent to a Stage. Double-click to use the page inside; click away to move it again. See `src/embed.ts`.

Not built yet in step 3: merging doc changes with layout edits (a refresh replaces the text), formatting buttons (markup is typed by hand), separate fonts or colours for headings, paragraph spacing and indents, control of stranded lines at the top or bottom of a frame, columns, and the Google Docs bridge.

Step 4 (layout suggestions and themes), first slice:

- Themes: "Plain", "High fantasy" and "Modern day". A theme sets the body font, a separate heading font and colour, ink colour, body size and paper colour, restyles all the text in the layout, and becomes the default for new frames. Paper colour prints. See `src/themes.ts`.
- "Suggest layouts" shows arrangements for the current page as thumbnails, built from a library of page patterns (art on top, edge to edge, at left or right, below, with one or two text columns). Picking one moves the page's frames; two-column patterns add a linked frame. See `src/suggest.ts`.

- Suggestions are ranked for the page's content and shown best first with a reason. The built-in ranking (free, instant, nothing leaves the computer) weighs the shape of the art, how much text there is and whether it fits, line length, page width, and whether the text opens with a heading.
- Optional: with `ANTHROPIC_API_KEY` set for the server (for example as a line in `.env.local`), the picker gains an "Ask Claude to rank these" button. Each click sends the start of the page's text and a description of each option to Anthropic and is billed to that key. Without a key the button does not appear. See `server/ai.mjs`.

Not built yet in step 4: ornaments and textures in themes, cropping images to fill a shape, suggestions across several pages at once.

Files on the Desk:

- "Add file" (or dropping files on the Desk) accepts images, PDFs and videos (MP4, WebM).
- A PDF opens in a built-in reader, one page at a time with previous and next, fitted to the item's width. The page being read is per device. See `src/PdfView.tsx`.
- A video plays in place with the browser's controls.
- Like links, PDFs and videos move, resize and go to Stages; double-click to use them, click away to move them.
- PDFs and videos are not stored inside the synced workspace. They are uploaded to a file store on the sync server (`server/files.mjs`, kept in `data/files/`, which Git ignores), and items point at them. Only PDF, MP4, WebM and common image types are accepted. Deleting an item does not yet delete its file.

Devices and Stages:

- The first time a device opens Mind Palace it is asked for a name and a type (phone, tablet, laptop, desktop PC or TV). Click the device's own entry in the dock to change them.
- A Stage is a surface like the Desk. Things sent to a device can be moved and resized there without disturbing the place they return to on the Desk; "Fit all" shows everything.
- Right-click an item (or press the ⋯ button on a selected item, for touch screens) for its menu. On a Stage: full screen, send to another device, send back to the Desk. On the Desk: send to a device, delete.
- Full screen shows one item filling the device; Esc or "Exit full screen" leaves it.
- Pinch to resize, on the Desk, a Stage or a layout page. On a touch screen, hold an item with one finger and pinch with a second (the second finger may land beside the item). On a laptop trackpad, select the item and pinch over it; Ctrl + mouse wheel does the same. The item keeps its proportions and stays centred. A pinch anywhere else zooms the surface.

Links:

- A specific YouTube video or playlist, a Vimeo video, or a Google Doc, Sheet or Slides file is shown live.
- Most other websites forbid being shown inside another page, and a web app cannot override that. "Add link" asks the server whether the page allows it (`server/link.mjs`); if not, the link becomes a card with the page's title and picture and a button that opens it in a new tab. The server only contacts public addresses when checking.
- Check the link rules with `node scripts/test-link.mjs`.

Connecting devices (the home setup, without Google sign-in):

- The computer running Mind Palace is always let in. Every other device must be connected once.
- "Connect a device" in the dock shows a QR code, the address to open, and a 6-digit code. A phone or tablet scans the QR code and is connected straight away; any other device opens the address and types the code.
- A connected device is remembered (a signed cookie, kept for a year), and can itself show the code to bring in another.
- Codes last ten minutes, can be used by several devices in that time, and are replaced after ten wrong guesses. Guessing is limited to eight tries a minute per device.
- Until connected, a device gets the code screen and nothing else: no workspace and no files.
- The key that signs device cookies is `data/pairing.key`. Deleting it disconnects every device; there is no way yet to disconnect just one.
- See `server/pairing.mjs`; check it with `node scripts/test-pairing.mjs`.

`npm run dev` starts two things: Vite, which serves the app, and the Mind Palace server (`server/sync-server.mjs`), which relays changes between devices, saves workspaces, holds the file store and handles sign-in. Workspaces are saved to `data/spaces/` and uploaded files to `data/files/`; back up the `data` folder to back up everything.

## Hosting it

The server can run as the whole app, so hosting it means running one process with one persistent folder.

```powershell
npm run build
npm start
```

`npm start` serves the built app, the workspace connection, files and sign-in on one port (`PORT`, default 1234).

Settings, as environment variables:

| Variable | Purpose |
|---|---|
| `ALLOWED_EMAILS` | Comma-separated Google addresses allowed in. Setting this switches sign-in on. |
| `GOOGLE_CLIENT_ID` | The Google OAuth client ID. The hosted address must be added to its authorised JavaScript origins. |
| `SESSION_SECRET` | A random string of at least 32 characters, used to sign session cookies. Keep it secret. |
| `PORT` | The port to listen on. Most hosts set this for you. |
| `DATA_DIR` | Where to keep workspaces and files. Point it at the host's persistent disk. |

With sign-in on, the workspace connection and every file require a signed-in, allowed account, and requests from other sites are refused. Without `ALLOWED_EMAILS`, sign-in is off, which is only suitable on a home network.

The `Dockerfile` builds an image that runs this (port 8080, data in `/app/data`). It has not been built or run yet.

### On Fly.io

`fly.toml` is set up for one small machine with a 1 GB volume at `/app/data`, HTTPS, and stopping when idle. In outline:

1. Install the Fly command-line tool and sign in (`fly auth login`).
2. `fly launch --no-deploy` in the project folder, keeping the existing configuration; choose an app name and region.
3. Set the three secrets with `fly secrets set --stage`: `ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`.
4. Add `https://<app-name>.fly.dev` to the Google OAuth client's authorised JavaScript origins.
5. `fly deploy`.

Run it as one machine only. The hosted workspace starts empty; an existing local workspace is carried over by copying `data/spaces/default.bin` (and `data/files/`) onto the volume.

Check the server with `node scripts/test-server.mjs` and, after a build, `node scripts/test-server-e2e.mjs`.

Not built yet: Viewer and Editor roles (everyone allowed in can edit), more than one space, inviting people from inside the app, and moving images out of the workspace into the file store.

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
