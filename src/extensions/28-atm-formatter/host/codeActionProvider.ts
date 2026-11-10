import * as vscode from 'vscode';
import type { AtmFormatterProvider } from './formatterProvider';

export class AtmFormatterCodeActionProvider implements vscode.CodeActionProvider {
	static readonly kind = vscode.CodeActionKind.SourceFixAll.append('atm');

	constructor(
		private readonly provider: AtmFormatterProvider,
		private readonly extensionId: string,
	) {}

	async provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeAction[]> {
		if (!context.only?.contains(AtmFormatterCodeActionProvider.kind) || token.isCancellationRequested) {
			return [];
		}

		const editorConfig = vscode.workspace.getConfiguration('editor', document);
		const saveActions = editorConfig.get<Record<string, string | boolean>>('codeActionsOnSave', {});
		const setting = saveActions[AtmFormatterCodeActionProvider.kind.value];
		if (setting === 'never' || setting === false) { return []; }
		const explicitlyEnabled = setting === 'explicit' || setting === 'always' || setting === true;
		const defaultFormatter = editorConfig.get<string>('defaultFormatter');
		if (!explicitlyEnabled && defaultFormatter && defaultFormatter !== this.extensionId) { return []; }

		const edits = await this.provider.formatDocument(document);
		if (edits.length === 0 || token.isCancellationRequested) { return []; }

		const action = new vscode.CodeAction(
			vscode.l10n.t('Format with ATM Formatter'),
			AtmFormatterCodeActionProvider.kind,
		);
		action.edit = new vscode.WorkspaceEdit();
		action.edit.set(document.uri, edits);
		return [action];
	}
}
