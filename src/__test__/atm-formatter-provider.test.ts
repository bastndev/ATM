import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AtmFormatterProvider } from '../extensions/28-atm-formatter/host/formatterProvider';
import { AtmFormatterCodeActionProvider } from '../extensions/28-atm-formatter/host/codeActionProvider';

suite('ATM Formatter — Provider Reliability', () => {
	const extensionId = 'bastndev.atm';
	const keys = [
		'atm.formatter.enable', 'atm.formatter.requireConfig', 'atm.formatter.ignorePath',
		'editor.defaultFormatter', 'editor.codeActionsOnSave',
	];
	const savedSettings = new Map<string, unknown>();
	let directory: string;
	let document: vscode.TextDocument;
	let provider: AtmFormatterProvider;
	let actions: AtmFormatterCodeActionProvider;
	let cancellation: vscode.CancellationTokenSource;
	let messages: string[];
	const range = new vscode.Range(0, 0, 0, 17);

	async function set(key: string, value: unknown): Promise<void> {
		await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
	}

	async function getActions(kind = vscode.CodeActionKind.SourceFixAll): Promise<vscode.CodeAction[]> {
		return actions.provideCodeActions(document, range, {
			diagnostics: [], only: kind, triggerKind: vscode.CodeActionTriggerKind.Automatic,
		}, cancellation.token);
	}

	suiteSetup(() => {
		for (const key of keys) {
			savedSettings.set(key, vscode.workspace.getConfiguration().inspect(key)?.globalValue);
		}
	});

	suiteTeardown(async () => {
		for (const [key, value] of savedSettings) { await set(key, value); }
	});

	setup(async () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-provider-'));
		const filePath = path.join(directory, 'app.ts');
		fs.writeFileSync(filePath, 'const x:number=1\n');
		fs.writeFileSync(path.join(directory, '.atmignore'), '');
		document = await vscode.workspace.openTextDocument(filePath);
		messages = [];
		const output = { appendLine: (line: string) => { messages.push(line); } };
		provider = new AtmFormatterProvider(output);
		actions = new AtmFormatterCodeActionProvider(provider, extensionId);
		cancellation = new vscode.CancellationTokenSource();
		await set('atm.formatter.enable', true);
		await set('atm.formatter.requireConfig', false);
		await set('atm.formatter.ignorePath', path.join(directory, '.atmignore'));
		await set('editor.defaultFormatter', extensionId);
		await set('editor.codeActionsOnSave', {});
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		cancellation.dispose();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	test('ignored documents and selections produce no edits, force format bypasses ignore', async () => {
		fs.writeFileSync(path.join(directory, '.atmignore'), '**/*.ts\n');
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		assert.deepStrictEqual(await provider.formatRange(document, range), []);
		assert.deepStrictEqual(await getActions(), []);
		assert.ok((await provider.forceFormat(document)).length > 0);
	});

	test('negation allows document and selection formatting', async () => {
		fs.writeFileSync(path.join(directory, '.atmignore'), '*.ts\n!app.ts\n');
		assert.ok((await provider.formatDocument(document)).length > 0);
		assert.ok((await provider.formatRange(document, range)).length > 0);
	});

	test('invalid config blocks document, selection, force format and save actions', async () => {
		const configPath = path.join(directory, '.prettierrc');
		fs.writeFileSync(configPath, '{');
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		assert.deepStrictEqual(await provider.formatRange(document, range), []);
		assert.deepStrictEqual(await provider.forceFormat(document), []);
		assert.deepStrictEqual(await getActions(), []);
		assert.strictEqual(document.getText(), 'const x:number=1\n');
		assert.ok(messages.some((message) => message.includes('Invalid configuration') && message.includes(configPath)));
	});

	test('invalid option values never produce edits', async () => {
		fs.writeFileSync(path.join(directory, '.prettierrc'), '{"semi":"invalid"}');
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		assert.deepStrictEqual(await provider.formatRange(document, range), []);
		assert.deepStrictEqual(await provider.forceFormat(document), []);
		assert.ok(messages.some((message) => message.includes('Error:')));
	});

	test('correcting invalid config allows the next formatting attempt', async () => {
		fs.writeFileSync(path.join(directory, '.prettierrc'), '{');
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		fs.writeFileSync(path.join(directory, '.prettierrc'), '{"semi":false}');
		const edits = await provider.formatDocument(document);
		assert.ok(edits.length > 0);
		assert.strictEqual(edits.some((edit) => edit.newText.includes(';')), false);
	});

	test('requireConfig applies to document, selection and save actions; force format bypasses it', async () => {
		await set('atm.formatter.requireConfig', true);
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		assert.deepStrictEqual(await provider.formatRange(document, range), []);
		assert.deepStrictEqual(await getActions(), []);
		assert.ok((await provider.forceFormat(document)).length > 0);
	});

	test('disabled formatter produces no normal edits or save actions', async () => {
		await set('atm.formatter.enable', false);
		assert.deepStrictEqual(await provider.formatDocument(document), []);
		assert.deepStrictEqual(await provider.formatRange(document, range), []);
		assert.deepStrictEqual(await getActions(), []);
	});

	test('does not participate in generic fixAll when another formatter is selected', async () => {
		await set('editor.defaultFormatter', 'other.formatter');
		assert.deepStrictEqual(await getActions(), []);
	});

	for (const setting of ['explicit', 'always', true]) {
		test('explicit ATM save action overrides another default formatter: ' + String(setting), async () => {
			await set('editor.defaultFormatter', 'other.formatter');
			await set('editor.codeActionsOnSave', { 'source.fixAll.atm': setting });
			assert.strictEqual((await getActions()).length, 1);
		});
	}

	for (const setting of ['never', false]) {
		test('explicitly disabled ATM save action is respected: ' + String(setting), async () => {
			await set('editor.codeActionsOnSave', { 'source.fixAll.atm': setting });
			assert.deepStrictEqual(await getActions(), []);
		});
	}

	test('provides a dedicated action with edits targeting the requested document', async () => {
		const result = await getActions(AtmFormatterCodeActionProvider.kind);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].kind?.value, 'source.fixAll.atm');
		assert.strictEqual(result[0].command, undefined);
		assert.ok(result[0].edit?.has(document.uri));
		const edits = result[0].edit!.get(document.uri);
		assert.strictEqual(edits.length, 1);
		const text = document.getText();
		const edit = edits[0];
		const formatted = text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
		assert.strictEqual(formatted, 'const x: number = 1;\n');
	});

	test('no default formatter still allows ATM fixAll', async () => {
		await set('editor.defaultFormatter', undefined);
		assert.strictEqual((await getActions()).length, 1);
	});

	test('unrelated action kinds and cancellation produce no actions', async () => {
		for (const kind of [vscode.CodeActionKind.SourceOrganizeImports, vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.SourceFixAll.append('other')]) {
			assert.deepStrictEqual(await getActions(kind), []);
		}
		cancellation.cancel();
		assert.deepStrictEqual(await getActions(), []);
	});
});
