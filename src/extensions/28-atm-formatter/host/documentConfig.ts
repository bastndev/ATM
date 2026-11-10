import * as path from 'path';
import * as vscode from 'vscode';
import { formatterService } from '../core/formatterService';
import { configFromVsCodeSettings, formatterSettingKeys, mergeConfig } from '../core/options';
import { resolveConfigForFile } from '../core/configResolver';
import { isFileIgnored } from '../core/ignoreResolver';
import type { FormatterConfig } from '../core/types';

export type FormatterState = 'ready' | 'formatting' | 'success' | 'ignored' | 'disabled' | 'missing-config' | 'error' | 'unsupported';
export interface DocumentStatus {
	uri: string;
	version: number;
	state: FormatterState;
	detail: string;
}
export interface DocumentConfig extends DocumentStatus {
	config?: FormatterConfig;
}

export function getWorkspaceRoot(document: vscode.TextDocument): string {
	return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
		?? (document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : process.cwd());
}

export function getIgnorePath(document: vscode.TextDocument): string {
	return vscode.workspace.getConfiguration(undefined, document).get<string>(formatterSettingKeys.ignorePath, '.atmignore');
}

export function isDocumentIgnored(document: vscode.TextDocument): boolean {
	return document.uri.scheme === 'file' && isFileIgnored(document.uri.fsPath, getWorkspaceRoot(document), getIgnorePath(document));
}

export async function inspectDocument(document: vscode.TextDocument, force = false): Promise<DocumentConfig> {
	const base = { uri: document.uri.toString(), version: document.version };
	const result = (state: FormatterState, detail: string, config?: FormatterConfig): DocumentConfig => ({ ...base, state, detail, config });
	try {
		if (!formatterService.isLanguageSupported(document.languageId)) { return result('unsupported', 'Unsupported language'); }
		const settings = vscode.workspace.getConfiguration(undefined, document);
		if (!force && !settings.get<boolean>(formatterSettingKeys.enable, true)) { return result('disabled', 'Disabled in settings'); }
		if (!force && isDocumentIgnored(document)) { return result('ignored', 'Excluded by ' + getIgnorePath(document) + ' or .prettierignore'); }
		const trusted = vscode.workspace.isTrusted;
		const resolved = document.uri.scheme === 'file'
			? await resolveConfigForFile(document.uri.fsPath, trusted)
			: { config: null, configPath: null };
		if (!force && document.uri.scheme === 'file' && settings.get<boolean>(formatterSettingKeys.requireConfig, false) && !resolved.configPath) {
			return result('missing-config', trusted ? 'A Prettier config file is required' : 'Project configuration is disabled in an untrusted workspace');
		}
		const fallback = configFromVsCodeSettings((key) => settings.get(key));
		const config = mergeConfig(resolved.config, fallback);
		// Project plugins are a separate capability; never overwrite the bundled parser set.
		const { plugins: _plugins, ...options } = config as FormatterConfig & { plugins?: unknown };
		const source = resolved.configPath ?? (resolved.config ? '.editorconfig' : 'VS Code settings');
		return result('ready', 'Configuration: ' + source + (trusted ? '' : ' (workspace not trusted)'), options);
	} catch (error) {
		return result('error', error instanceof Error ? error.message : String(error));
	}
}
