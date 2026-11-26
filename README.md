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

Not built yet in step 2: a refine brush for cut-outs, loading fonts beyond those installed on the computer, bleed and crop marks, cropping images inside frames, arranging cards onto sheets.

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
