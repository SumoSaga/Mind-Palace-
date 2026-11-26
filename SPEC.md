# Mind Palace — Project Spec

Decisions settled in the planning interview of 26 November 2026.

## What it is

A workspace that spans computers, phones, tablets and TVs. Documents, images, PDFs, videos and tools sit on a shared canvas, can be moved, resized and rotated, and can be sent between connected devices. The first major tool is a layout tool for tabletop RPG books, sheets and components.

## Core decisions

| Topic | Decision |
|---|---|
| Audience | Built for one user first. Data model supports other users and shared spaces from the start (every space has an owner and a members list). |
| Form | Web app, installable as a PWA. Devices join by QR code or link. TVs are display surfaces, not editing stations. |
| Storage | Cloud hosted. Designed so offline editing can be added later; large files stay online-only longest. Video is linked (e.g. YouTube) rather than stored at first. |
| Sign-in | Google sign-in only. New devices join by scanning a QR code from a signed-in device. |
| Roles | Owner, Editor, Viewer per space. Added after the foundation. |
| Engine | Our own canvas engine on permissively licensed libraries, not a whiteboard toolkit. Accepts a slower, rougher start in exchange for owning the core. |
| Stack | TypeScript web app; an open-source sync library suited to live collaboration and later offline use; hosted backend for sign-in, storage and relaying changes; Claude for layout suggestions. |

## Devices: the Desk and Stages

- **The Desk** is the shared infinite canvas. Every item has a home position on it.
- **Each device has a Stage**, its own area holding items sent to it.
- **Sending is a move, not a copy.** Dragging an item onto a device in the dock moves it to that device's Stage. An item is in exactly one place at a time.
- **A marker stays on the Desk** at the item's home position, labelled with the device. Clicking the marker, or "send back" on the device, returns the item.
- **Stages lay themselves out.** One item fills the screen. Several items become swipeable tabs on phones and tiles on larger screens.
- **Any capable device can open the Desk** as well as its own Stage.
- **Stages are saved.** If a device disconnects, its Stage returns when it reconnects. Items remain recallable from their markers in the meantime.
- **Collaborators' devices get Stages too.**

## How outside tools fit

| Tool | Approach |
|---|---|
| Layout tool, image editor, PDF viewer, video, notes | Built in |
| Google Docs | Live editable embed on the canvas, plus pull and push of text through Google's API |
| Illustrator, Photoshop | Round trip through a helper program on the PC (later) |
| Streaming a desktop app window to other devices | Deferred indefinitely |

Notes on Google Docs:

- Typing in the embedded doc works because the embed is the real editor.
- Pushed text lands at the end of the doc or under a chosen heading, not at the cursor. Copy and paste covers cursor-precise placement.
- An embedded doc follows Google's sharing, not Mind Palace's roles.

## The layout tool

**Outputs**

- Books: facing pages, running headers, page numbers, chapters. Target size 150 to 200 pages, plus smaller concept books.
- Single sheets: character sheets, handouts, posters.
- Components: cards, tokens and tiles at exact sizes, with automatic arrangement onto sheets with cut lines.
- Data-driven sets (one template plus a spreadsheet of rows) follow shortly after the baseline.

**Printing**

- True-size printing to the user's own printer, including tiled cards and aligned double-sided sheets.
- Print-service presets that set page size, bleed and safe margins. First presets: DriveThruRPG (books) and The Game Crafter (components). Check current specifications when building.
- No direct ordering.
- CMYK conversion is deferred until a chosen service requires it.

**Long text**

1. Independent text boxes first (enough for sheets, cards and concept books).
2. Linked frames next: text flows across frames, columns and pages and reflows on edit. This is its own milestone and comes before layout suggestions.
3. Whole-chapter layout later, built on linked frames plus suggestions.

Tables and stat blocks are dedicated frame types styled per theme.

**Google Docs as text source**

- The doc stays the source of truth.
- Each text flow remembers its doc and section. Sections map by heading, with a fallback that detects bold-line headings.
- Refresh shows what changed in the doc and lets the user accept changes while keeping layout styling.
- Layout edits can be pushed back to the doc on demand. Nothing syncs automatically.

**Layout suggestions**

- A library of page patterns and style themes does the precise placement.
- Claude reads the content, chooses suitable patterns, adapts and ranks them.
- Interaction: select text and images, press Suggest, get four to six thumbnail options, pick one, and it becomes ordinary editable frames.
- Themes are original kits (fonts, colours, ornaments, textures, frame styles) based on genre conventions, not copies of any published book.
- First themes: high fantasy, and modern day.

**Image editing**

- One-click background removal, a refine brush (erase and restore), crop, flip, rotate.
- Brightness, contrast, colour, saturation, theme filters, drop shadows, outlines, edge blending into the page.
- All edits are non-destructive: the original is kept and edits are a stored list of adjustments.
- Background removal runs on-device in the browser. Weak devices hand the job to a stronger connected device. A paid cloud option may be added later.
- No full painting editor; that is covered by the round trip to a desktop editor.

## Build order

0. **Design:** a small design system in Figma and mockups of three or four key screens (Desk, phone Stage, spread editor, suggestion picker).
1. **Foundation:** Desk with images and text boxes (move, resize, rotate), live across two devices, with the dock and Stages.
2. **Manual layout tool:** spreads, text and image frames, fonts, PDF export, true-size printing, one-click background removal.
3. **Linked text frames** and the Google Docs bridge.
4. **Layout suggestions** and the two themes.
5. **Fuller image editor.**
6. **Everything else:** PDF viewer, Google Docs embed, video, collaborator roles, print-service presets, data-driven cards, Illustrator round trip.

## Risks to test early

- Google Docs sign-in inside an embed may be unreliable on iPhone and iPad. Prototype before depending on it.
- Linked text flow is the hardest engineering in the project.
- Background removal will be slow on phones.
- CMYK output is not available until a conversion step is added.

## Setup still needed

- Install Git and Node.js on the development PC.
- Choose a project folder and connect it to https://github.com/SumoSaga/Mind-Palace-.git
- Accounts to be created by the owner when step 1 needs them: a Google Cloud project (sign-in and Docs connection), a hosting account, an Anthropic API key.
