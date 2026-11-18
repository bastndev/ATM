import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getLanguageConfig } from '../extensions/06-comments-code/core/languages';

interface GrammarContribution {
	language?: string;
	scopeName: string;
	path: string;
}

interface LanguageContribution {
	id: string;
	configuration?: string;
}

suite('TOML', () => {
	const extensionId = 'bastndev.atm';
	let tempDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-toml-'));
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('every TOML grammar and language file in the manifest exists and matches its scope', () => {
		const extension = vscode.extensions.getExtension(extensionId);
		assert.ok(extension, `extension ${extensionId} is not loaded`);
		const contributes = extension.packageJSON.contributes as {
			grammars: GrammarContribution[];
			languages: LanguageContribution[];
		};

		const grammars = contributes.grammars.filter((g) => g.path.includes('/31-toml/'));
		assert.deepStrictEqual(
			grammars.map((g) => g.scopeName).sort(),
			['markdown.toml.codeblock', 'markdown.toml.frontmatter.codeblock', 'source.toml'],
		);
		for (const grammar of grammars) {
			const file = path.join(extension.extensionPath, grammar.path);
			const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { scopeName: string };
			assert.strictEqual(json.scopeName, grammar.scopeName, grammar.path);
		}

		const toml = contributes.languages.find((l) => l.id === 'toml');
		assert.ok(toml?.configuration, 'toml language has no configuration');
		assert.ok(fs.existsSync(path.join(extension.extensionPath, toml.configuration)));
	});

	test('.toml, Cargo.lock and uv.lock open as TOML', async () => {
		assert.ok((await vscode.languages.getLanguages()).includes('toml'));

		for (const name of ['Cargo.toml', 'Cargo.lock', 'uv.lock']) {
			const file = path.join(tempDir, name);
			fs.writeFileSync(file, '[package]\nname = "demo"\n');
			const document = await vscode.workspace.openTextDocument(file);
			assert.strictEqual(document.languageId, 'toml', name);
		}
	});

	test('Toggle Line Comment uses #', async () => {
		const file = path.join(tempDir, 'comment.toml');
		fs.writeFileSync(file, 'opt-level = 3\n');
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
		editor.selection = new vscode.Selection(0, 0, 0, 0);

		await vscode.commands.executeCommand('editor.action.commentLine');

		assert.strictEqual(editor.document.lineAt(0).text, '# opt-level = 3');
		await vscode.commands.executeCommand('workbench.action.files.revert');
	});

	test('comment tags read # comments in TOML', () => {
		assert.deepStrictEqual(getLanguageConfig('toml'), { singleLine: '#' });
	});
});
