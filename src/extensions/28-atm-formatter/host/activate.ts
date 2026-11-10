import * as vscode from 'vscode';
import { AtmFormatterProvider, buildDocumentSelectors, buildRangeSelectors } from './formatterProvider';
import { AtmFormatterCodeActionProvider } from './codeActionProvider';
import { FormatterStatusBar } from './statusBar';
import { registerFormatterCommands } from './commands';
import { formatterSettingKeys } from '../core/options';

/**
 * ATM Formatter — activation entry point.
 *
 * Registers document/range formatting providers and a code-action provider
 * for the languages declared in `core/languages/`.  Also registers the
 * `atm.formatter.*` commands and a status bar item.
 *
 * To add a new technology, see `core/languages/index.ts`.
 */

let statusBar: FormatterStatusBar | undefined;

export function activateAtmFormatter(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel('ATM Formatter');
	const provider = new AtmFormatterProvider(outputChannel);
	statusBar = new FormatterStatusBar(outputChannel);

	const docSelectors = buildDocumentSelectors();
	const rangeSelectors = buildRangeSelectors();

	// Register document formatting provider (all enabled languages)
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(docSelectors, provider),
	);

	// Register range formatting provider (only languages with rangeFormatting)
	if (rangeSelectors.length > 0) {
		context.subscriptions.push(
			vscode.languages.registerDocumentRangeFormattingEditProvider(rangeSelectors, provider),
		);
	}

	// Register code-action provider for "format on save"
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(docSelectors, new AtmFormatterCodeActionProvider(provider, context.extension.id), {
			providedCodeActionKinds: [AtmFormatterCodeActionProvider.kind],
		}),
	);

	// Register commands
	const commandDisposables = registerFormatterCommands(provider, statusBar, outputChannel);
	context.subscriptions.push(...commandDisposables);

	// Status bar: update on active editor change
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			statusBar?.update(editor);
		}),
	);
	statusBar.update(vscode.window.activeTextEditor);

	// Re-register providers when config changes (enable toggle, etc.)
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(formatterSettingKeys.enable)) {
				statusBar?.update(vscode.window.activeTextEditor);
			}
		}),
	);

	// Push output channel + status bar as disposables
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(statusBar);

	outputChannel.appendLine('[formatter] ATM Formatter activated — supported languages: TypeScript, TSX, CSS, Astro, JSON');
}

export function deactivateAtmFormatter(): void {
	statusBar?.dispose();
	statusBar = undefined;
}
