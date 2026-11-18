import * as vscode from 'vscode';
import { ConversionResult, jsonToToml, tomlToJson } from '../core/convert';

export const COPY_AS_JSON = 'atm.toml.copyAsJson';
export const PASTE_AS_TOML = 'atm.toml.pasteAsToml';
export const COPY_AS_TOML = 'atm.toml.copyAsToml';
export const PASTE_AS_JSON = 'atm.toml.pasteAsJson';

/**
 * TOML ↔ JSON conversion. Copy commands convert the selection, or the whole
 * file when nothing is selected. Paste commands convert the clipboard and
 * insert it at the cursor, matching the line's indentation.
 */
export function registerConversionCommands(): vscode.Disposable[] {
	return [
		registerEditorCommand(COPY_AS_JSON, (editor) => copyConverted(editor, 'JSON')),
		registerEditorCommand(COPY_AS_TOML, (editor) => copyConverted(editor, 'TOML')),
		registerEditorCommand(PASTE_AS_TOML, (editor) => pasteConverted(editor, 'TOML')),
		registerEditorCommand(PASTE_AS_JSON, (editor) => pasteConverted(editor, 'JSON')),
	];
}

/**
 * Unlike registerTextEditorCommand, which does not wait for an async
 * callback, this resolves only once the conversion is done.
 */
function registerEditorCommand(id: string, run: (editor: vscode.TextEditor) => Promise<void>): vscode.Disposable {
	return vscode.commands.registerCommand(id, async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			await run(editor);
		}
	});
}

type Format = 'JSON' | 'TOML';

async function copyConverted(editor: vscode.TextEditor, target: Format): Promise<void> {
	const { document, selection } = editor;
	const text = selection.isEmpty ? document.getText() : document.getText(selection);
	if (text.trim() === '') {
		void vscode.window.showInformationMessage(vscode.l10n.t('ATM TOML: there is nothing to copy.'));
		return;
	}
	const result = target === 'JSON' ? await tomlToJson(text, 2) : await jsonToToml(text);
	if (!result.ok) {
		showConversionError(result, selection.isEmpty ? 0 : selection.start.line);
		return;
	}
	await vscode.env.clipboard.writeText(result.text);
	vscode.window.setStatusBarMessage(
		target === 'JSON' ? vscode.l10n.t('$(check) Copied as JSON') : vscode.l10n.t('$(check) Copied as TOML'),
		2500,
	);
}

async function pasteConverted(editor: vscode.TextEditor, target: Format): Promise<void> {
	const clipboard = await vscode.env.clipboard.readText();
	if (clipboard.trim() === '') {
		void vscode.window.showInformationMessage(vscode.l10n.t('ATM TOML: the clipboard is empty.'));
		return;
	}
	// Tabs are converted to the editor's indentation when the snippet is inserted.
	const result = target === 'TOML' ? await jsonToToml(clipboard) : await tomlToJson(clipboard, '\t');
	if (!result.ok) {
		showConversionError(result, 0);
		return;
	}
	await editor.insertSnippet(new vscode.SnippetString().appendText(result.text));
}

function showConversionError(result: Exclude<ConversionResult, { ok: true }>, lineOffset: number): void {
	let message: string;
	switch (result.reason) {
		case 'invalidToml':
			message = vscode.l10n.t(
				'ATM TOML: invalid TOML at line {0}, column {1}: {2}',
				result.error.line + lineOffset,
				result.error.column,
				result.error.message,
			);
			break;
		case 'invalidJson':
			message = vscode.l10n.t('ATM TOML: invalid JSON: {0}', result.message);
			break;
		case 'notAnObject':
			message = vscode.l10n.t('ATM TOML: TOML needs a JSON object at the top level.');
			break;
		default:
			message = vscode.l10n.t('ATM TOML: this JSON cannot be written as TOML: {0}', result.message);
	}
	void vscode.window.showErrorMessage(message);
}
