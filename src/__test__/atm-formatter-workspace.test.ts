import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { inspectDocument } from '../extensions/28-atm-formatter/host/documentConfig';
import { AtmFormatterProvider } from '../extensions/28-atm-formatter/host/formatterProvider';

suite('ATM Formatter — Workspace Folder Settings', function () {
	this.timeout(10000);
	test('two folders use independent options and custom ignore files', async function () {
		const folders = vscode.workspace.workspaceFolders;
		const first = folders?.find((folder) => folder.name === 'ATM Formatter A');
		const second = folders?.find((folder) => folder.name === 'ATM Formatter B');
		// A dedicated multi-root test launch supplies these isolated workspace fixtures.
		if (!first || !second) { this.skip(); return; }
		const provider = new AtmFormatterProvider({ appendLine: () => {} });
		try {
			for (const [folder, semi] of [[first, false], [second, true]] as const) {
				const file = path.join(folder.uri.fsPath, 'app.ts');
				fs.writeFileSync(file, 'const x:number=1');
				const document = await vscode.workspace.openTextDocument(file);
				const inspected = await inspectDocument(document);
				assert.strictEqual(inspected.config?.semi, semi);
				assert.ok((await provider.formatDocument(document)).length > 0);
				await vscode.commands.executeCommand('atm.formatter.addToAtmIgnore', document.uri);
				assert.strictEqual(fs.readFileSync(path.join(folder.uri.fsPath, 'formatter.ignore'), 'utf-8'), '/app.ts\n');
				assert.strictEqual(fs.existsSync(path.join(folder.uri.fsPath, '.atmignore')), false);
				assert.strictEqual((await inspectDocument(document)).state, 'ignored');
			}
		} finally { provider.dispose(); }
	});
});
