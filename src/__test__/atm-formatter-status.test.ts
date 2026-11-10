import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { FormatterStatusBar } from '../extensions/28-atm-formatter/host/statusBar';
import { FormatterConfigWatcher } from '../extensions/28-atm-formatter/host/configWatcher';
import { inspectDocument, type DocumentConfig } from '../extensions/28-atm-formatter/host/documentConfig';

suite('ATM Formatter — Status Feedback', function () {
	this.timeout(10000);
	let directory: string;
	let editor: vscode.TextEditor;
	let bar: FormatterStatusBar;
	let item: vscode.StatusBarItem;
	const savedSettings = new Map<string, unknown>();
	const keys = ['atm.formatter.enable', 'atm.formatter.requireConfig', 'atm.formatter.ignorePath', '[typescript]'];

	suiteSetup(() => {
		for (const key of keys) { savedSettings.set(key, vscode.workspace.getConfiguration().inspect(key)?.globalValue); }
	});
	suiteTeardown(async () => {
		for (const [key, value] of savedSettings) {
			await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
		}
	});

	setup(async () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-status-'));
		const file = path.join(directory, 'app.ts');
		fs.writeFileSync(file, 'const x=1');
		for (const [key, value] of [
			['atm.formatter.enable', true], ['atm.formatter.requireConfig', false],
			['atm.formatter.ignorePath', path.join(directory, '.atmignore')], ['[typescript]', {}],
		] as const) {
			await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
		}
		editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
		item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
		bar = new FormatterStatusBar({ show: () => {} }, item);
	});
	teardown(async () => {
		bar.dispose();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(directory, { recursive: true, force: true });
	});

	test('ready status identifies project configuration, and errors identify the bad file', async () => {
		fs.writeFileSync(path.join(directory, '.prettierrc.yaml'), 'semi: false');
		await bar.update(editor);
		assert.ok(String(item.tooltip).includes('.prettierrc.yaml'));
		fs.writeFileSync(path.join(directory, '.prettierrc.yaml'), 'semi: [');
		await bar.update(editor);
		assert.ok(item.text.includes('error'));
		assert.ok(String(item.tooltip).includes('Invalid configuration'));
	});

	test('formatting results persist until configuration is invalidated', async () => {
		await bar.update(editor);
		bar.record({ uri: editor.document.uri.toString(), version: editor.document.version, state: 'error', detail: 'Syntax error in source' });
		await bar.update(editor);
		assert.ok(String(item.tooltip).includes('Syntax error'));
		bar.invalidate();
		await bar.update(editor);
		assert.ok(item.text.includes('check'));
		assert.ok(String(item.tooltip).includes('Configuration:'));
	});

	test('a late inspection of another editor cannot overwrite the current editor', async () => {
		const otherFile = path.join(directory, 'other.ts');
		fs.writeFileSync(otherFile, 'const y=1');
		const other = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(otherFile));
		let release!: (status: DocumentConfig) => void;
		const pending = new Promise<DocumentConfig>((resolve) => { release = resolve; });
		bar.dispose();
		bar = new FormatterStatusBar({ show: () => {} }, item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right),
			(document) => document === editor.document ? pending : inspectDocument(document));
		const first = bar.update(editor);
		await bar.update(other);
		const expected = item.tooltip;
		release({ uri: editor.document.uri.toString(), version: editor.document.version, state: 'error', detail: 'Stale result' });
		await first;
		assert.strictEqual(item.tooltip, expected);
		assert.ok(!String(item.tooltip).includes('Stale result'));
	});

	test('watchers detect configuration and ignore file creation, edits and deletion', async function () {
		this.timeout(15000);
		let notify: (() => void) | undefined;
		const watcher = new FormatterConfigWatcher(() => { notify?.(); });
		// VS Code starts external-directory watchers asynchronously.
		await new Promise((resolve) => setTimeout(resolve, 500));
		async function change(action: () => void): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Configuration watcher did not refresh')), 3000);
				notify = () => { clearTimeout(timeout); resolve(); };
				action();
			});
			notify = undefined;
		}
		try {
			const config = path.join(directory, '.prettierrc');
			await change(() => fs.writeFileSync(config, '{"semi":false}'));
			assert.strictEqual((await inspectDocument(editor.document)).config?.semi, false);
			await change(() => fs.writeFileSync(config, '{"semi":true}'));
			assert.strictEqual((await inspectDocument(editor.document)).config?.semi, true);
			await change(() => fs.unlinkSync(config));
			const ignore = path.join(directory, '.atmignore');
			await change(() => fs.writeFileSync(ignore, '*.ts'));
			assert.strictEqual((await inspectDocument(editor.document)).state, 'ignored');
			await change(() => fs.unlinkSync(ignore));
			assert.strictEqual((await inspectDocument(editor.document)).state, 'ready');
		} finally { watcher.dispose(); }
	});
});
