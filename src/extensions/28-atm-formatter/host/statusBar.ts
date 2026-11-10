import * as vscode from 'vscode';
import { formatterSettingKeys } from '../core/options';
import { languageRegistry } from '../core/languageRegistry';
import { isDocumentIgnored } from './formatterProvider';

/**
 * Status bar item showing whether ATM Formatter is active for the current
 * document's language.
 *
 * States:
 *  - Green  $(check)     — supported and not ignored
 *  - Yellow $(warning)   — supported but ignored by .atmignore
 *  - Hidden               — unsupported language or no editor
 */
export class FormatterStatusBar {
	private readonly item: vscode.StatusBarItem;
	private readonly outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
		this.item.command = 'atm.formatter.showOutput';
	}

	/** Update the status bar based on the active editor's language. */
	update(editor: vscode.TextEditor | undefined): void {
		const enabled = vscode.workspace.getConfiguration().get<boolean>(formatterSettingKeys.enable, true);
		if (!enabled) {
			this.item.text = '$(circle-slash) Format |';
			this.item.tooltip = 'ATM Formatter is disabled';
			this.item.backgroundColor = undefined;
			this.item.hide();
			return;
		}

		if (!editor || !editor.document) {
			this.item.hide();
			return;
		}

		const supported = languageRegistry.isLanguageSupported(editor.document.languageId);
		if (!supported) {
			this.item.hide();
			return;
		}

		let ignored: boolean;
		try {
			ignored = isDocumentIgnored(editor.document);
		} catch (error) {
			this.item.text = '$(error) Format |';
			this.item.tooltip = `ATM Formatter — could not read ignore rules: ${String(error)}`;
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			this.item.show();
			return;
		}
		if (ignored) {
			this.item.text = '$(warning) Format |';
			this.item.tooltip = `ATM Formatter — ${editor.document.languageId} (ignored by .atmignore)`;
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			this.item.show();
		} else {
			this.item.text = '$(check) Format |';
			this.item.tooltip = `ATM Formatter — ${editor.document.languageId}`;
			this.item.backgroundColor = undefined;
			this.item.show();
		}
	}

	showOutput(): void {
		this.outputChannel.show(true);
	}

	dispose(): void {
		this.item.dispose();
	}
}
