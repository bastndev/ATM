import * as vscode from 'vscode';
import { shouldExcludeFromErrorLens } from './exclusions';
import { inlineMessage } from './message';

/* =========================================================
 * 🛡️ VALIDATION CHECKS
 * ========================================================= */

// Fast filter to avoid applying to output or git panels
function _shouldExclude(scheme: string): boolean {
  return scheme === 'output' || scheme === 'git' || scheme === 'debug';
}

/* =========================================================
 * 🚀 CORE ENGINE UPDATE DECORATIONS
 * ========================================================= */

/**
 * Optimizations applied:
 * 1. Map used for O(1) performance.
 * 2. Filter out Hint/Info. Keep only the most severe error.
 * 3. Ghost rendering avoidance (using margin instead of blank spaces).
 * 4. Each message covers its whole line (see ui/styles.ts), so VS Code
 *    moves it with the code while you type, like the squiggle, and nothing
 *    has to be recomputed per keystroke.
 */
export function updateDecorationsForEditor(
  editor: vscode.TextEditor,
  styles: {
    error: vscode.TextEditorDecorationType;
    warning: vscode.TextEditorDecorationType;
  },
): void {
  const document = editor.document;
  if (!document || _shouldExclude(document.uri.scheme)) {
    return;
  }
  
  if (shouldExcludeFromErrorLens(document.uri.fsPath)) {
    return;
  }

  const diagnostics = vscode.languages.getDiagnostics(document.uri);

  const errorOptions: vscode.DecorationOptions[] = [];
  const warningOptions: vscode.DecorationOptions[] = [];

  const diagnosticsByLine = new Map<number, vscode.Diagnostic>();

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity > vscode.DiagnosticSeverity.Warning) {
      continue;
    }

    const line = diagnostic.range.start.line;
    const existing = diagnosticsByLine.get(line);

    // Filter out lesser severity diagnostics (Error > Warning)
    // TIE BREAKER: If both are Errors, keep the one with the longest message.
    if (!existing || diagnostic.severity < existing.severity) {
      diagnosticsByLine.set(line, diagnostic);
    } else if (
      diagnostic.severity === existing.severity &&
      diagnostic.message.length > existing.message.length
    ) {
      diagnosticsByLine.set(line, diagnostic);
    }
  }

  for (const [line, diagnostic] of diagnosticsByLine) {
    // Diagnostics arrive async and can be stale: a fix that removes lines may
    // leave ranges past EOF; lineAt would throw and abort before setDecorations
    // clears old lenses (stale-decoration bug). Skip them.
    if (line >= document.lineCount) {
      continue;
    }
    const text = document.lineAt(line).text;

    // The whole line: the message is drawn after its end wherever the range sits.
    const range = new vscode.Range(line, 0, line, text.length);

    // One line, cut between the message's lines (no newline: avoids the ghost background box)
    const cleanMsg = inlineMessage(diagnostic.message);

    if (!cleanMsg) {
      continue;
    }

    const icon =
      diagnostic.severity === vscode.DiagnosticSeverity.Error ? '✖' : '⚠';
    const message = `${icon}  ${cleanMsg}`;

    const decorationOptions: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: message,
        },
      },
    };

    if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
      errorOptions.push(decorationOptions);
    } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
      warningOptions.push(decorationOptions);
    }
  }

  editor.setDecorations(styles.error, errorOptions);
  editor.setDecorations(styles.warning, warningOptions);
}
