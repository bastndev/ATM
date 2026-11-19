/* =========================================================
 * ✂️ INLINE MESSAGE
 * No VS Code API here, so it is unit-tested.
 * ========================================================= */

/** Longest text shown at the end of a line. */
export const MAX_INLINE_CHARS = 100;

const SEPARATOR = ' · ';

/**
 * The text shown after the code: the message's first line, then as many of
 * the next lines as fit whole. A long message is cut between lines, not in
 * the middle of a word. Compilers put the detail on later lines, e.g. rustc:
 * "mismatched types · expected `u32`, found `&str`".
 */
export function inlineMessage(message: string, max = MAX_INLINE_CHARS): string {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return '';
  }

  let text = clip(lines[0], max);
  for (const line of lines.slice(1)) {
    const longer = text + SEPARATOR + line;
    if (longer.length > max) {
      break;
    }
    text = longer;
  }
  return text;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
