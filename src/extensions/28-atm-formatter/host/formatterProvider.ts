import * as vscode from 'vscode';
import { formatterService } from '../core/formatterService';
import { languageRegistry } from '../core/languageRegistry';
import { configFromVsCodeSettings, mergeConfig, formatterSettingKeys } from '../core/options';
import { resolveConfigForFile } from '../core/configResolver';
import { isFileIgnored } from '../core/ignoreResolver';
import type { FormatterConfig } from '../core/types';

/**
 * VS Code formatting providers (document + range) backed by the
 * {@link FormatterService}.
 *
 * The provider resolves the parser from the language registry, merges
 * config from `.prettierrc` (if found) with VS Code settings, calls
 * Prettier, and returns a single minimal `TextEdit` computed by diffing
 * the common prefix/suffix so VS Code applies the smallest possible change.
 */

/** Get the workspace root folder for a document, or the first workspace folder. */
function getWorkspaceRoot(document: vscode.TextDocument): string {
	if (document.uri.scheme === 'file') {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (folder) { return folder.uri.fsPath; }
	}
	const folders = vscode.workspace.workspaceFolders;
	return folders?.[0]?.uri.fsPath ?? process.cwd();
}

/** Resolve the full config for a document: .prettierrc (priority) + VS Code settings. */
function resolveFullConfig(document: vscode.TextDocument): { config: FormatterConfig; hasConfigFile: boolean } {
	const workspaceRoot = getWorkspaceRoot(document);
	const filePath = document.uri.fsPath;

	// 1. Try .prettierrc / package.json prettier key
	const prettierConfig = document.uri.scheme === 'file'
		? resolveConfigForFile(filePath, workspaceRoot)
		: { config: null, configPath: null };

	// 2. VS Code settings (used as fallback for missing options)
	const vsCodeConfig = configFromVsCodeSettings((key) =>
		vscode.workspace.getConfiguration().get(key),
	);

	// 3. Merge: .prettierrc wins, VS Code fills the gaps
	const merged = mergeConfig(prettierConfig.config, vsCodeConfig);
	return { config: merged, hasConfigFile: prettierConfig.configPath !== null };
}

/** Check if a document is ignored by .atmignore. */
export function isDocumentIgnored(document: vscode.TextDocument): boolean {
	if (document.uri.scheme !== 'file') { return false; }
	const workspaceRoot = getWorkspaceRoot(document);
	const ignorePathSetting = vscode.workspace.getConfiguration().get<string>(formatterSettingKeys.ignorePath) ?? '.atmignore';
	return isFileIgnored(document.uri.fsPath, workspaceRoot, ignorePathSetting);
}

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

/** Whether the formatter is enabled and the document should be formatted. */
function shouldFormat(document: vscode.TextDocument): boolean {
	const enabled = vscode.workspace.getConfiguration().get<boolean>(formatterSettingKeys.enable, true);
	if (!enabled) { return false; }
	if (!languageRegistry.isLanguageSupported(document.languageId)) { return false; }
	if (isDocumentIgnored(document)) { return false; }
	return true;
}

export class AtmFormatterProvider
	implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

	constructor(private readonly outputChannel: Pick<vscode.OutputChannel, 'appendLine'>) {}

	private resolveFormattingConfig(document: vscode.TextDocument, force = false): FormatterConfig | undefined {
		try {
			if (!force && !shouldFormat(document)) { return undefined; }
			const { config, hasConfigFile } = resolveFullConfig(document);
			const requireConfig = vscode.workspace.getConfiguration().get<boolean>(formatterSettingKeys.requireConfig, false);
			if (!force && requireConfig && document.uri.scheme === 'file' && !hasConfigFile) {
				this.outputChannel.appendLine(`[formatter] Skipping ${document.fileName} — no config found and requireConfig is on`);
				return undefined;
			}
			return config;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`[formatter] Skipping ${document.fileName}: ${message}`);
			void vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: {0}', message));
			return undefined;
		}
	}

	async provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		_options: vscode.FormattingOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		return this.formatDocument(document);
	}

	async provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
		_options: vscode.FormattingOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		return this.formatRange(document, range);
	}

	/** Format the entire document. */
	async formatDocument(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
		const config = this.resolveFormattingConfig(document);
		if (!config) { return []; }

		const parser = formatterService.getParserForLanguageId(document.languageId);
		if (!parser) { return []; }

		const text = document.getText();
		const filepath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;

		this.outputChannel.appendLine(`[formatter] Formatting ${document.fileName} (parser: ${parser})`);
		const result = await formatterService.formatDocument({ text, parser, filepath, config });

		if (result.error) {
			this.outputChannel.appendLine(`[formatter] Error: ${result.error}`);
			vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: {0}', result.error));
			return [];
		}

		return computeMinimalEdit(document, text, result.formatted);
	}

	/** Format a selection range within the document. */
	async formatRange(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.TextEdit[]> {
		if (!formatterService.supportsRangeFormatting(document.languageId)) { return []; }
		const config = this.resolveFormattingConfig(document);
		if (!config) { return []; }

		const parser = formatterService.getParserForLanguageId(document.languageId);
		if (!parser) { return []; }

		const text = document.getText();
		const filepath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
		const rangeStart = document.offsetAt(range.start);
		const rangeEnd = document.offsetAt(range.end);

		this.outputChannel.appendLine(`[formatter] Formatting range ${document.fileName}:${range.start.line + 1}-${range.end.line + 1}`);
		const result = await formatterService.formatRange({
			text, parser, filepath, config, rangeStart, rangeEnd,
		});

		if (result.error) {
			this.outputChannel.appendLine(`[formatter] Error: ${result.error}`);
			return [];
		}

		return computeMinimalEdit(document, text, result.formatted);
	}

	/** Force format — ignores .atmignore and requireConfig. */
	async forceFormat(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
		const parser = formatterService.getParserForLanguageId(document.languageId);
		if (!parser) {
			vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: language "{0}" is not supported', document.languageId));
			return [];
		}

		const config = this.resolveFormattingConfig(document, true);
		if (!config) { return []; }
		const text = document.getText();
		const filepath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;

		this.outputChannel.appendLine(`[formatter] Force formatting ${document.fileName}`);
		const result = await formatterService.formatDocument({ text, parser, filepath, config });

		if (result.error) {
			this.outputChannel.appendLine(`[formatter] Error: ${result.error}`);
			vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: {0}', result.error));
			return [];
		}

		return computeMinimalEdit(document, text, result.formatted);
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
