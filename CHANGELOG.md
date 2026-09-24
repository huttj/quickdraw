# Changelog

All notable changes to the `@quickdrawjs/*` packages are documented here.
The project follows [semver](https://semver.org); the three packages are
versioned in lockstep.

## Unreleased

- **Image cropping.** Double-click an image (or press Enter, or pick "Crop
  image" from the context menu) to enter crop mode: the whole picture shows
  faintly around the window, the handles trim it, and a drag inside slides
  the picture behind it. The crop is stored as `props.crop`, fractions of
  the source; the whole session is one undo step. `startCrop` / `endCrop` /
  `resetCrop` on the editor.
- **Groups.** ⌘G groups the selection, ⇧⌘G ungroups. Members share a
  `groupId` (no container record, so the wire format is unchanged).
  Selecting a member selects the group; double-click dives in, Esc steps
  back out. Duplicating or pasting a group makes a new group.
- **Context menu** on right-click and on a long press with a finger: cut /
  copy / paste / duplicate / delete, group / ungroup, a Reorder flyout, an
  Align flyout, crop, edit text, export — or paste / select all / zoom /
  export / clear over empty paper. Hosts with their own chrome get a
  `'contextmenu'` editor event.
- **Alignment and distribution.** `alignSelection(mode)` and
  `distributeSelection(axis)`, with tldraw's ⌥A/D/W/S/H/V and ⇧⌥H/V keys.
- **One-step ordering.** `bringForward` / `sendBackward` step past one
  neighbour; only the moved shapes change z. Keys follow tldraw: `]` / `[`
  step, `⇧]` / `⇧[` go all the way. (Previously `]` / `[` went all the way.)
- **Drag tools onto the board.** Pull the shape, arrow, line, text or note
  tool off the dock and let go on the board to drop a ready-made one there;
  `editor.dropShape(kind, at)` for custom UIs.
- **Sticky notes have a width.** `props.w` (absent = the classic 200) sets
  how wide a note is; `props.h` a minimum height (tldraw's growY comes
  across as that). A note never gets shorter than its words.
- **Text formatting, shown as you type.** The text editor is now a
  contenteditable surface styled like the canvas, so bold, italic,
  underline, strike, code, highlights and links appear the moment you
  apply them. ⌘B / ⌘I / ⌘U, ⇧⌘X (strike), ⌘E (code), ⇧⌘H (highlight) and
  ⌘K (link) apply to the selection, or to what you type next; a small bar
  above the text offers the same. Pastes into the editor land as plain
  text; ⌘Z inside it steps through the edit. `editor.toggleMark`,
  `setLink`, `editingStyle` for custom UIs; `editor.editing.textarea` keeps
  a textarea's API (value, selection, setSelectionRange) over the surface.
- **The text surface matches the canvas on phones.** iOS could boost the
  surface's type at small zooms, so editing text looked a size larger than
  the drawn text and jumped with the zoom; the surface now pins its size.
- **Notes honour the align style.** Left, centre or right, like text; a
  note without one is centred, as before. The styles panel applies it to a
  selected note.
- **An emptied note evaporates,** the way emptied text always has.
- **Touch: the hand comes first.** On a touch screen the dock leads with the
  hand tool and never drops it when the frame narrows; a still finger on the
  hand tool opens the context menu, as it does on the pointer.
- **Touch: pan while typing.** A finger on the board while the text surface
  is open pans (two fingers pinch) and keeps the text open, since the
  keyboard covers half the screen; a still tap beside it commits as before.
- **Sticky notes handle like text.** S / M / L / XL are the same type sizes
  as a text shape's (they used to run a step smaller). A side pull sets
  the width and the words rewrap; the whole top or bottom edge scales the
  type, the sticky growing with it; a corner scales it whole.
- **⌘= / ⌘- / ⌘0 always zoom the board**, wherever focus is on the page —
  the browser's own zoom never fires. A field that isn't the board's keeps
  its keys.
- **Double-click picks the word.** Double-clicking text opens it for editing
  with the word under the pointer selected (just the caret, on whitespace);
  a third quick click selects everything. Enter still selects all.
- **Text is edited in place.** A rotated text, note or label is edited at
  its angle: the surface turns about the shape's centre like the canvas
  does, instead of snapping flat. The board no longer scrolls to chase a
  caret that wanders past its edge.
- **Links open on release.** A press on a linked shape or word opens it
  when the button comes up without a drag, so a linked shape can still be
  dragged around.
- **The action bar is for fingers.** The undo / redo / duplicate / delete
  pill now shows only where the primary input is touch; with a mouse and
  keyboard every one of those is a key away. `actions: 'always' | 'never'`
  (core, React, React Native, or `ui.setOptions`) overrides.
- **Minimap.** The whole drawing at a glance in the top-right corner:
  shapes as soft blocks, the viewport as a frame. Click or drag to put the
  view there, scroll on it to zoom; buttons over its corners zoom to fit and close it. Hidden on
  narrow boards; `minimap: false` (or the React prop) drops it.
- **tldraw's fonts, bundled.** `@quickdrawjs/core/fonts.css` self-hosts the
  faces tldraw uses — Shantell Sans for hand-drawn text, IBM Plex Sans,
  Serif and Mono for the rest (all SIL Open Font License; the licences ship
  in `fonts/`). Import it next to `quickdraw.css`; the font stacks lead with
  these and fall back to system faces without it. Text re-lays out when the
  fonts finish loading. About 1.4 MB of woff2 across sixteen cuts, loaded on
  demand per family and style.
- **Highlights show on dark pixels.** The band gets a faint plain pass on
  top of its multiply (or lighten, in the dark theme), so it still reads
  over a black picture — or a white one in the dark theme.
- **Type size from the edge.** A text box's top and bottom edges (the whole
  edge, not just the square) are a size handle: drag to grow or shrink the
  type, the wrap width stays, the far edge stays put.
- **Font and alignment in the styles panel.** The four type families
  (hand-drawn, sans, serif, mono) and text alignment (left / centre /
  right) get rows in the styles popover; `setStyle('font' | 'align', …)`.
- **Text edits stay put.** Tabs are kept as spaces everywhere text comes
  in (a tab drew as one space on the canvas and eight columns in the
  editor, so the editor spread the line out), and a line's trailing spaces
  no longer shift centred or right-aligned text.
- **Rotate from the corners.** With a mouse there's no knob: the cursor
  becomes tldraw's corner rotate arrow just outside each corner of the
  selection, aligned to that corner, and turns with the shape as you drag.
  Touch boards keep the knob.
- **Highlights keep their z order.** They used to render in a layer under
  everything else; now they sit where they were drawn, like in tldraw — the
  multiply blend still reads as marker over ink, and a highlight drawn over
  a picture stays on top of it (a pasted tldraw board's highlights included).
- **Marked text.** Text, notes and shape labels can carry bold, italic,
  underline, strike, code, highlight and link runs (`props.marks` /
  `props.labelMarks`); they render on the canvas and in SVG, survive
  editing, and a linked run opens on click. Any shape can carry a
  `props.url`, shown as a link badge at its corner. tldraw pastes bring
  all of this across.
- **Hollow shapes and groups move from their middle.** Pressing the empty
  inside of an unfilled shape, or the empty space inside a group's frame,
  selects and drags it; the smallest such body wins. The eraser still needs
  the edge.
- **Paste from tldraw.** Copy in tldraw, ⌘V here: text, notes, shapes with
  labels, ink, highlights, arrows and lines with their bindings, images
  with their crops, frames and groups. Reads tldraw's clipboard payload
  (its v2/v3 JSON and the older lz-string form) with dependency-free ports
  of the two codecs it uses. Plain text pasted from anywhere becomes a text
  shape. `parseTldrawClipboard` / `editor.importTldraw` for custom UIs.
- **Arrows bind to shapes.** An arrow or line drawn from inside a shape, or
  ended over one, ties itself to it and follows the shape as it moves,
  resizes or rotates; the end sits on the shape's outline. Drag an end onto
  another shape to re-tie it, or onto empty paper to free it; ⌥ aims at the
  exact point. Stored on the arrow's props as `startBind` / `endBind`.
  Under the hood: `store.react()` runs derived-record updates inside the
  same transaction, so a moved shape and its arrows are one diff.
- **SVG export.** "Export as SVG" in the board and context menus,
  `editor.exportSvg()` from code, `exportSvg()` over the React Native
  bridge, and `sceneToSvg` / `shapeToSvg` for headless use. `onSave` now
  receives a third argument, `format` ('png' | 'svg').
- **Rotated shapes resize.** A rotated shape shows its handles on its own
  frame and resizes in it; the opposite edge stays put. Its rotate knob now
  turns with the frame instead of hovering over the bounding box.
- **Resize pinning fixed; resize about the centre.** A side pull on text now
  sets its wrap width (the type keeps its size and reflows; text has no
  top/bottom handles); a side pull on a sticky note scales it as a whole.
  In both the far edge stays pinned, as it always did for shapes and
  images. ⌥ or Ctrl resizes about the centre. Handle squares turn with a
  rotated shape.
- **⌥ copies mid-drag.** Alt/Option is live for the whole move: while it's
  down the drag is a copy (the originals stay put), let go and it's a move
  again. Whatever is on when the button comes up is what's kept.
- **The pointer is the default tool again** when a board mounts (0.1.3 had
  switched it to the pen). `editor.setTool('draw')` after mount if you
  want the old behaviour.
- New: `editor.resetZoom()`, `editor.editShapeText(id)`, `imageFrame()`.

## 0.1.3 — 2026-08-01

- The pen (draw) tool is now selected by default when a board mounts,
  instead of the select tool — everywhere: core, React, React Native,
  the hosted app, and the site demos.

## 0.1.2 — 2026-08-01

- npm discovery keywords added to all three packages. No code changes.

## 0.1.1 — 2026-08-01

- Lines are now bendable: drag the new midpoint anchor to curve a line,
  exactly like arrows. Lines and arrows both show three anchors
  (start, midpoint, end).
- Fixed: straight arrows could not be bent — the midpoint anchor
  collapsed onto the end anchor when `bend` was 0, making it ungrabbable.

## 0.1.0 — 2026-08-01

First public release.

- `@quickdrawjs/core` — the framework-free engine: pressure-sensitive
  freehand ink, highlighter, shapes with hand-drawn wobble, arrows with
  draggable bend, text, sticky notes, images, laser pointer, selection with
  move/resize/rotate, infinite canvas with pan/zoom/pinch, palm rejection,
  per-gesture undo/redo, light & dark themes, ruled/dotted grid backdrops,
  PNG export, responsive floating toolbar, and a diff-emitting store built
  for persistence and real-time sync. Zero runtime dependencies.
- `@quickdrawjs/react` — `<Quickdraw />` component with `snapshot`,
  `onChange`, `onSave`, `autoFit`, and an imperative ref to the editor.
- `@quickdrawjs/react-native` — WebView-based component with a typed bridge:
  `getSnapshot()`, `exportPng()`, theme control, Apple Pencil pressure, and
  palm rejection. Ships a self-contained HTML bundle; works offline.
