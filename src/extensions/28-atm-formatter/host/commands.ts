import * as vscode from 'vscode';
import type { AtmFormatterProvider } from './formatterProvider';
import type { FormatterStatusBar } from './statusBar';
import { addResourcesToIgnoreFile } from './ignoreCommands';

/**
 * Registers the `atm.formatter.*` commands.
 *
 * Commands:
 *  - `atm.formatter.formatDocument` — format the active document (respects .atmignore)
 *  - `atm.formatter.forceFormat`    — format ignoring .atmignore and requireConfig
 *  - `atm.formatter.showOutput`     — reveal the output channel
 *  - `atm.formatter.addToAtmIgnore`   — append Explorer resources to an ignore file
 */

/** Register all formatter commands. Returns disposables to push. */
export function registerFormatterCommands(
	provider: AtmFormatterProvider,
	statusBar: FormatterStatusBar,
	outputChannel: vscode.OutputChannel,
): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('atm.formatter.formatDocument', async (uri?: vscode.Uri) => {
			const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!targetUri) {
				vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: no active document'));
				return;
			}

			const document = await vscode.workspace.openTextDocument(targetUri);
			const edits = await provider.formatDocument(document);
			if (edits.length === 0) { return; }

			const workspaceEdit = new vscode.WorkspaceEdit();
			workspaceEdit.set(targetUri, edits);
			const success = await vscode.workspace.applyEdit(workspaceEdit);
			if (success) {
				outputChannel.appendLine(`[formatter] Applied ${edits.length} edit(s) to ${document.fileName}`);
			}
		}),

		vscode.commands.registerCommand('atm.formatter.forceFormat', async (uri?: vscode.Uri) => {
			const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!targetUri) {
				vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: no active document'));
				return;
			}

			const document = await vscode.workspace.openTextDocument(targetUri);
			const edits = await provider.forceFormat(document);
			if (edits.length === 0) { return; }

			const workspaceEdit = new vscode.WorkspaceEdit();
			workspaceEdit.set(targetUri, edits);
			const success = await vscode.workspace.applyEdit(workspaceEdit);
			if (success) {
				outputChannel.appendLine(`[formatter] Force-applied ${edits.length} edit(s) to ${document.fileName}`);
			}
		}),

		vscode.commands.registerCommand('atm.formatter.showOutput', () => {
			statusBar.showOutput();
		}),

		vscode.commands.registerCommand(
			'atm.formatter.addToAtmIgnore',
			(resourceUri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
				addResourcesToIgnoreFile(resourceUri, selectedUris, outputChannel),
		),
	];
}
