import * as vscode from 'vscode';
import { Token, tokenizeRust } from '../core/lexer';

const MAX_ENTRIES = 20;

/** Hints and the underline read the same tokens after every edit, so they are cached per document version. */
export class RustTokenCache implements vscode.Disposable {
	private readonly entries = new Map<string, { version: number; tokens: Token[] }>();
	private readonly closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
		this.entries.delete(document.uri.toString());
	});

	get(document: vscode.TextDocument): Token[] {
		const key = document.uri.toString();
		const cached = this.entries.get(key);
		if (cached && cached.version === document.version) {
			return cached.tokens;
		}
		const tokens = tokenizeRust(document.getText());
		this.entries.delete(key);
		this.entries.set(key, { version: document.version, tokens });
		if (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
		return tokens;
	}

	dispose(): void {
		this.closeListener.dispose();
		this.entries.clear();
	}
}
