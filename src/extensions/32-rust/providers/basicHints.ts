import * as vscode from 'vscode';
import { findLetTypeHints } from '../core/literalTypes';
import { RustTokenCache } from './tokenCache';

/**
 * `: f64`, `: bool`, `: &str`… after `let`. Only types that are obvious from
 * the value are shown; anything else, such as a function's result, gets no
 * hint rather than a guess.
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
				inlay.tooltip = vscode.l10n.t('Type of the value, read from the code.');
				return inlay;
			});
	}
}
