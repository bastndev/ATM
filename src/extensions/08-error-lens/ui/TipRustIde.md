# Error Lens — UI notes

## Known conflict: Antigravity "Explain and Fix Problem" hint

In **Antigravity** (not VS Code, not Cursor), the Error Lens message on the caret line can be covered. Only the ✖ / ⚠ stays visible.

**Cause**

- Antigravity has a built-in editor widget: `antigravity.markerHoverInlayHint`.
- It appears on the line with the **caret** (not the mouse) when that line has an Error or Warning.
- It is anchored at the end of the line's real text, shifted right by `tabSize × spaceWidth`, with an **opaque** background 10,000px wide.
- Error Lens messages are CSS `::after` decorations. The editor doesn't count them as text, so the widget is drawn on top of them.
- The box appears instantly; the "Explain and Fix Problem (Ctrl+…)" text appears ~1.5 s later. It hides when the editor loses focus.
- Only the icon survives because the uncovered gap is ~4 characters (tab size 4), and the pill starts after 16px margin + 10px padding (`styles.ts`).

**Why the extension can't fix it directly**

- No setting turns the widget off.
- Extensions can't style or move another widget. Making our message transparent doesn't help: the opaque box is on top.
- Antigravity skips lines that have ghost-text decorations, but detects them by internal names an extension can't set.

**Planned workaround** (not implemented yet)

Only in Antigravity (`vscode.env.appName`): on the caret line, show an icon-only pill that fits in the gap and move the full message to the status bar. Other lines and other editors stay unchanged.

## Lessons for a custom editor (Rust)

- Treat end-of-line annotations as real layout items (virtual text), not overlays, so anything placed after them knows their width.
- Give the end-of-line space one owner with priorities (diagnostics, AI hints, ghost text, blame). Resolve collisions in layout, not by painting on top.
- Anchor widgets to the visual end of the line (after virtual text), not to the last text column.
- Avoid opaque backgrounds on floating hints; they hide whatever is underneath.
- Anchor end-of-line messages to their **line**, not to a column, and let the editor move them with edits like squiggles. ATM's Error Lens does this with `isWholeLine` + `ClosedClosed` (`styles.ts`): Enter at the end of the line keeps the message there, and nothing is recomputed per keystroke, only when diagnostics change.
- Cut a long message between its lines, not mid-word (`core/message.ts`): compilers put the detail on later lines.
