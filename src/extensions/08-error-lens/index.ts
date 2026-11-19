import * as vscode from 'vscode';
import { createDecorationStyles } from './ui/styles';
import { updateDecorationsForEditor } from './core/engine';

export function activateErrorLens(context: vscode.ExtensionContext): void {
  /* =========================================================
   * 🎨 INITIALIZE SETTINGS (UI)
   * ========================================================= */
  const styles = createDecorationStyles();

  /* =========================================================
   * ⏱️ DEBOUNCE & UPDATE
   * Only editors whose diagnostics changed are redrawn. Typing redraws
   * nothing: the messages are anchored to their lines, so VS Code moves
   * them with the code (see ui/styles.ts).
   * ========================================================= */
  let diagnosticTimer: NodeJS.Timeout | null = null;
  const DEBOUNCE_MS = 300;
  const changedUris = new Set<string>();
  let redrawAll = false;

  const flush = () => {
    diagnosticTimer = null;
    for (const editor of vscode.window.visibleTextEditors) {
      if (!redrawAll && !changedUris.has(editor.document.uri.toString())) {
        continue;
      }
      // one failing editor must not block clearing decorations in the rest
      try {
        updateDecorationsForEditor(editor, styles);
      } catch (err) {
        console.error('[error-lens] Failed to update decorations:', err);
      }
    }
    changedUris.clear();
    redrawAll = false;
  };

  /** No uris: every visible editor (one may have just opened). */
  const triggerUpdate = (uris?: readonly vscode.Uri[]) => {
    if (uris) {
      uris.forEach((uri) => changedUris.add(uri.toString()));
    } else {
      redrawAll = true;
    }
    if (diagnosticTimer) {
      clearTimeout(diagnosticTimer);
    }
    diagnosticTimer = setTimeout(flush, DEBOUNCE_MS);
  };

  /* =========================================================
   * 🔌 REGISTER CORE EVENTS
   * ========================================================= */
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      triggerUpdate(event.uris);
    }),
    // Switching tabs or splitting creates new editors, which start without decorations.
    vscode.window.onDidChangeVisibleTextEditors(() => {
      triggerUpdate();
    }),
    styles,
    { dispose: () => diagnosticTimer && clearTimeout(diagnosticTimer) },
  );

  /* =========================================================
   * 🚀 INITIAL RENDER
   * ========================================================= */
  triggerUpdate();
}
