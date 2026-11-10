import * as vscode from 'vscode';
import { inspectDocument, type DocumentStatus, type FormatterState } from './documentConfig';

const icons: Record<FormatterState, string> = {
	ready: 'check', formatting: 'sync~spin', success: 'check-all', ignored: 'warning',
	disabled: 'circle-slash', 'missing-config': 'warning', error: 'error', unsupported: 'circle-slash',
};

export class FormatterStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private editor: vscode.TextEditor | undefined;
	private revision = 0;
	private disposed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly outcomes = new Map<string, DocumentStatus>();

	constructor(
		private readonly outputChannel: Pick<vscode.OutputChannel, 'show'>,
		item?: vscode.StatusBarItem,
		private readonly inspect = inspectDocument,
	) {
		this.item = item ?? vscode.window.createStatusBarItem('atm.formatter.status', vscode.StatusBarAlignment.Right, 50);
		this.item.name = 'ATM Formatter';
		this.item.command = 'atm.formatter.showOutput';
	}

	async update(editor: vscode.TextEditor | undefined): Promise<void> {
		if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
		this.editor = editor;
		const revision = ++this.revision;
		if (!editor) { this.item.hide(); return; }
		const document = editor.document;
		const cached = this.outcomes.get(document.uri.toString());
		if (cached?.version === document.version) { this.render(cached); return; }
		const status = await this.inspect(document);
		if (this.disposed || revision !== this.revision || status.version !== document.version) { return; }
		this.render(status);
	}

	record(status: DocumentStatus): void {
		if (this.disposed) { return; }
		this.outcomes.set(status.uri, status);
		if (this.editor?.document.uri.toString() === status.uri && this.editor.document.version === status.version) {
			this.revision++;
			this.render(status);
		}
	}

	invalidate(): void {
		this.outcomes.clear();
		void this.update(this.editor);
	}

	forget(document: vscode.TextDocument): void { this.outcomes.delete(document.uri.toString()); }

	documentChanged(document: vscode.TextDocument): void {
		this.forget(document);
		this.revision++;
		if (this.timer) { clearTimeout(this.timer); }
		// Avoid reloading configuration from disk on every keystroke.
		this.timer = setTimeout(() => { this.timer = undefined; void this.update(this.editor); }, 150);
	}

	private render(status: DocumentStatus): void {
		if (status.state === 'unsupported') { this.item.hide(); return; }
		this.item.text = '$(' + icons[status.state] + ') Format |';
		this.item.tooltip = 'ATM Formatter — ' + status.detail;
		this.item.backgroundColor = status.state === 'error'
			? new vscode.ThemeColor('statusBarItem.errorBackground')
			: status.state === 'ignored' || status.state === 'missing-config'
				? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
		this.item.show();
	}

	showOutput(): void { this.outputChannel.show(true); }
	dispose(): void {
		this.disposed = true;
		if (this.timer) { clearTimeout(this.timer); }
		this.revision++;
		this.outcomes.clear();
		this.item.dispose();
	}
}
