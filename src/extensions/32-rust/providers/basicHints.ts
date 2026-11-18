import * as vscode from 'vscode';
import { findLetTypeHints } from '../core/literalTypes';
import { RustTokenCache } from './tokenCache';

/**
 * `: f64`, `: bool`, `: &str`… after `let` when rust-analyzer is not running.
 * Only obvious types are shown; rust-analyzer replaces these with exact ones.
 */
export class BasicTypeHintsProvider implements vscode.InlayHintsProvider {
	constructor(private readonly tokens: RustTokenCache) {}

	provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
		const start = document.offsetAt(range.start);
		const end = document.offsetAt(range.end);
		return findLetTypeHints(this.tokens.get(document))
			.filter((hint) => hint.offset >= start && hint.offset <= end)
			.map((hint) => {
				const inlay = new vscode.InlayHint(document.positionAt(hint.offset), hint.label, vscode.InlayHintKind.Type);
				inlay.tooltip = vscode.l10n.t('Simple type guess. Install rust-analyzer for exact types.');
				return inlay;
			});
	}
}
