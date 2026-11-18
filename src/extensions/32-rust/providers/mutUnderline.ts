import * as vscode from 'vscode';
import { findMutableSpans } from '../core/mutables';
import { RustTokenCache } from './tokenCache';

const DEBOUNCE_MS = 150;

/**
 * Underlines `mut` variables when rust-analyzer is not running. With
 * rust-analyzer, the same underline comes from its semantic colors instead.
 */
export class MutUnderline implements vscode.Disposable {
	private readonly decoration = vscode.window.createTextEditorDecorationType({ textDecoration: 'underline' });
	private readonly listeners: vscode.Disposable[];
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly tokens: RustTokenCache) {
		this.listeners = [
			vscode.window.onDidChangeVisibleTextEditors(() => this.schedule()),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.languageId === 'rust') {
					this.schedule();
				}
			}),
		];
		this.updateAll();
	}

	private schedule(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => this.updateAll(), DEBOUNCE_MS);
	}

	private updateAll(): void {
		this.timer = undefined;
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.languageId !== 'rust') {
				continue;
			}
			const document = editor.document;
			const ranges = findMutableSpans(this.tokens.get(document)).map(
				(span) => new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
			);
			editor.setDecorations(this.decoration, ranges);
		}
	}

	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.listeners.forEach((listener) => listener.dispose());
		this.decoration.dispose();
	}
}
