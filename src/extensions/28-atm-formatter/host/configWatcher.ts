import * as path from 'path';
import * as vscode from 'vscode';
import { getIgnorePath, getWorkspaceRoot } from './documentConfig';

const configPatterns = ['.prettierrc', '.prettierrc.*', 'prettier.config.*', '.editorconfig', 'package.json', 'package.yaml'];

export class FormatterConfigWatcher implements vscode.Disposable {
	private readonly subscriptions: vscode.Disposable[] = [];
	private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly invalidate: () => void) {
		this.rebuild();
		this.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(() => this.rebuild()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => { this.rebuild(); this.schedule(); }),
			vscode.workspace.onDidGrantWorkspaceTrust(() => this.schedule()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('atm.formatter')) { this.rebuild(); this.schedule(); }
			}),
		);
	}

	private schedule = (): void => {
		if (this.timer) { clearTimeout(this.timer); }
		this.timer = setTimeout(() => { this.timer = undefined; this.invalidate(); }, 75);
	};

	private rebuild(): void {
		const patterns = new Map<string, vscode.RelativePattern>();
		const add = (directory: string, pattern: string) => {
			patterns.set(directory + '\0' + pattern, new vscode.RelativePattern(directory, pattern));
		};
		const roots = new Set(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath));
		const document = vscode.window.activeTextEditor?.document;
		if (document?.uri.scheme === 'file') {
			const root = getWorkspaceRoot(document);
			roots.add(root);
			const ignorePath = path.resolve(root, getIgnorePath(document));
			add(path.dirname(ignorePath), path.basename(ignorePath));
		}
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const setting = vscode.workspace.getConfiguration('atm.formatter', folder.uri).get<string>('ignorePath', '.atmignore');
			const ignorePath = path.resolve(folder.uri.fsPath, setting);
			add(path.dirname(ignorePath), path.basename(ignorePath));
		}
		for (const root of roots) {
			for (const pattern of [...configPatterns, '.atmignore', '.prettierignore']) {
				add(root, pattern);
				if (vscode.workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === root)) { add(root, '**/' + pattern); }
			}
			// Native configuration discovery can find a monorepo config above the opened folder.
			let parent = path.dirname(root);
			while (parent !== root) {
				for (const pattern of configPatterns) { add(parent, pattern); }
				const next = path.dirname(parent);
				if (next === parent) { break; }
				parent = next;
			}
		}
		for (const [key, watcher] of this.watchers) {
			if (!patterns.has(key)) { watcher.dispose(); this.watchers.delete(key); }
		}
		for (const [key, pattern] of patterns) {
			if (this.watchers.has(key)) { continue; }
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidChange(this.schedule);
			watcher.onDidCreate(this.schedule);
			watcher.onDidDelete(this.schedule);
			this.watchers.set(key, watcher);
		}
	}

	dispose(): void {
		if (this.timer) { clearTimeout(this.timer); }
		this.watchers.forEach((watcher) => watcher.dispose());
		this.subscriptions.forEach((subscription) => subscription.dispose());
	}
}
