import * as vscode from 'vscode';

/**
 * The message is attached to the whole line and drawn after its end
 * (isWholeLine), and the range never grows at its edges (ClosedClosed).
 * VS Code then moves it with the code as you type, exactly like the
 * squiggle: Enter at the end of the line leaves it on that line, Enter at
 * the start carries it down with the code. Before, the message sat at a
 * fixed column, jumped to the new line on Enter, and had to be redrawn
 * after every keystroke to stay in place.
 */
const LINE_ANCHOR: vscode.DecorationRenderOptions = {
  isWholeLine: true,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
};

export function createDecorationStyles() {
  const errorOptions = vscode.window.createTextEditorDecorationType({
    ...LINE_ANCHOR,
    after: {
      backgroundColor: '#ff2a6d22',
      color: '#ff2a6d',
      margin: '0 0 0 16px',
      textDecoration:
        'none; font-size: 0.95em; border-radius: 8px; padding: 3px 10px; font-weight: normal; font-style: normal;',
    },
  });

  const warningOptions = vscode.window.createTextEditorDecorationType({
    ...LINE_ANCHOR,
    after: {
      backgroundColor: '#ff980022',
      color: '#ffb300',
      margin: '0 0 0 16px',
      textDecoration:
        'none; font-size: 0.95em; border-radius: 8px; padding: 3px 10px; font-weight: normal; font-style: normal;',
    },
  });

  return {
    error: errorOptions,
    warning: warningOptions,
    dispose: () => {
      errorOptions.dispose();
      warningOptions.dispose();
    },
  };
}
