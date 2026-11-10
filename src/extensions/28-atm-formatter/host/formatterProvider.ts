import * as vscode from 'vscode';
import { formatterService } from '../core/formatterService';
import { languageRegistry } from '../core/languageRegistry';
import { inspectDocument, type DocumentStatus } from './documentConfig';

/** Compute a single minimal TextEdit by diffing common prefix/suffix. */
function computeMinimalEdit(document: vscode.TextDocument, oldText: string, newText: string): vscode.TextEdit[] {
	if (oldText === newText) { return []; }

	// Find common prefix length
	let prefixLen = 0;
	const minLen = Math.min(oldText.length, newText.length);
	while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
		prefixLen++;
	}

	// Find common suffix length (not overlapping with prefix)
	let suffixLen = 0;
	while (
		suffixLen < minLen - prefixLen &&
		oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	const startPos = document.positionAt(prefixLen);
	const endPos = document.positionAt(oldText.length - suffixLen);
	const replaceText = newText.slice(prefixLen, newText.length - suffixLen);

	return [vscode.TextEdit.replace(new vscode.Range(startPos, endPos), replaceText)];
}

export class AtmFormatterProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider, vscode.Disposable {
	private readonly changes = new vscode.EventEmitter<DocumentStatus>();
	readonly onDidChangeStatus = this.changes.event;
	private readonly requests = new Map<string, number>();

	constructor(private readonly outputChannel: Pick<vscode.OutputChannel, 'appendLine'>) {}

	dispose(): void { this.changes.dispose(); this.requests.clear(); }

	provideDocumentFormattingEdits(document: vscode.TextDocument, _options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
		return this.format(document, undefined, false, token);
	}

	provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, _options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
		return this.format(document, range, false, token);
	}

	formatDocument(document: vscode.TextDocument): Promise<vscode.TextEdit[]> { return this.format(document); }
	formatRange(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.TextEdit[]> { return this.format(document, range); }
	forceFormat(document: vscode.TextDocument): Promise<vscode.TextEdit[]> { return this.format(document, undefined, true); }

	private async format(document: vscode.TextDocument, range?: vscode.Range, force = false, token?: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
		if (range && !formatterService.supportsRangeFormatting(document.languageId)) { return []; }
		const uri = document.uri.toString();
		const version = document.version;
		const request = (this.requests.get(uri) ?? 0) + 1;
		this.requests.set(uri, request);
		const isLatest = () => version === document.version && this.requests.get(uri) === request;
		const isCurrent = () => !token?.isCancellationRequested && isLatest();
		const resolved = await inspectDocument(document, force);
		if (!isCurrent()) { return []; }
		this.changes.fire(resolved);
		this.outputChannel.appendLine('[formatter] ' + document.fileName + ': ' + resolved.detail);
		if (!resolved.config) {
			if (resolved.state === 'error') { void vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: {0}', resolved.detail)); }
			if (force && resolved.state === 'unsupported') {
				void vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: language "{0}" is not supported', document.languageId));
			}
			return [];
		}
		const parser = formatterService.getParserForLanguageId(document.languageId);
		if (!parser) { return []; }
		try {
			this.outputChannel.appendLine('[formatter] Options: ' + JSON.stringify(resolved.config));
		} catch {
			this.outputChannel.appendLine('[formatter] Options could not be serialized for logging');
		}
		this.changes.fire({ ...resolved, state: 'formatting', detail: 'Formatting with ' + parser });
		const text = document.getText();
		const input = { text, parser, filepath: document.uri.scheme === 'file' ? document.uri.fsPath : undefined, config: resolved.config };
		const result = range
			? await formatterService.formatRange({ ...input, rangeStart: document.offsetAt(range.start), rangeEnd: document.offsetAt(range.end) })
			: await formatterService.formatDocument(input);
		if (!isCurrent()) {
			if (token?.isCancellationRequested && isLatest()) {
				this.changes.fire({ ...resolved, state: 'ready', detail: 'Formatting cancelled' });
			}
			return [];
		}
		if (result.error) {
			this.outputChannel.appendLine('[formatter] Error: ' + result.error);
			this.changes.fire({ ...resolved, state: 'error', detail: result.error });
			void vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: {0}', result.error));
			return [];
		}
		const edits = computeMinimalEdit(document, text, result.formatted);
		const detail = (edits.length ? 'Formatting edits prepared. ' : 'Already formatted. ') + resolved.detail;
		this.outputChannel.appendLine('[formatter] ' + detail);
		this.changes.fire({ ...resolved, state: 'success', detail });
		return edits;
	}
}

/* ── Selector builders ──────────────────────────────────────────────── */

/** Build the DocumentFilter selectors for document formatting registration. */
export function buildDocumentSelectors(): vscode.DocumentFilter[] {
	return languageRegistry.getEnabledLanguageIds().map((languageId) => ({
		language: languageId,
		scheme: 'file',
	}));
}

/** Build the DocumentFilter selectors for range formatting registration. */
export function buildRangeSelectors(): vscode.DocumentFilter[] {
	return languageRegistry.getRangeFormattingLanguageIds().map((languageId) => ({
		language: languageId,
		scheme: 'file',
	}));
}
