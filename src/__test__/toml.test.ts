import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getLanguageConfig } from '../extensions/06-comments-code/core/languages';
import { jsonToToml, tomlToJson } from '../extensions/31-toml/core/convert';
import { computeFoldingRanges } from '../extensions/31-toml/core/folding';
import { buildOutline, OutlineNode } from '../extensions/31-toml/core/outline';
import { scanToml } from '../extensions/31-toml/core/scanner';
import { validateToml } from '../extensions/31-toml/core/validate';
import { VALIDATION_SETTING } from '../extensions/31-toml/providers/diagnostics';
import { COPY_AS_JSON, PASTE_AS_TOML } from '../extensions/31-toml/ui/commands';

interface GrammarContribution {
	language?: string;
	scopeName: string;
	path: string;
}

interface LanguageContribution {
	id: string;
	configuration?: string;
}

const extensionId = 'bastndev.atm';

const SAMPLE = [
	'# Build settings', // 0
	'# shared by every crate', // 1
	'[workspace]', // 2
	'members = [', // 3
	'  "apps/*", # apps', // 4
	'  "crates/*",', // 5
	']', // 6
	'', // 7
	'# Versions live here.', // 8
	'[workspace.package]', // 9
	'version = "0.1.0"', // 10
	'notes = """', // 11
	'[not.a.table]', // 12
	'"""', // 13
	'', // 14
	'[profile.release]', // 15
	'lto = "thin"', // 16
	'opt = { level = 3, debug = false }', // 17
	'',
].join('\n');

/** `name(child,child)` for a quick structural comparison. */
function shape(nodes: ReadonlyArray<{ name: string; children: ReadonlyArray<unknown> }>): string {
	return nodes
		.map((node) => {
			const children = node.children as ReadonlyArray<{ name: string; children: ReadonlyArray<unknown> }>;
			return children.length > 0 ? `${node.name}(${shape(children)})` : node.name;
		})
		.join(',');
}

function find(nodes: OutlineNode[], name: string): OutlineNode {
	const node = nodes.find((candidate) => candidate.name === name);
	assert.ok(node, `no outline node named ${name}`);
	return node;
}

async function waitFor<T>(probe: () => T | undefined, what: string, timeoutMs = 5000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== undefined) {
			return value;
		}
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

function tomlDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
	return vscode.languages.getDiagnostics(uri).filter((diagnostic) => diagnostic.source === 'TOML');
}

suite('TOML', () => {
	let tempDir: string;

	suiteSetup(async () => {
		await vscode.extensions.getExtension(extensionId)?.activate();
	});

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-toml-'));
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function openFile(name: string, content: string): Promise<vscode.TextDocument> {
		const file = path.join(tempDir, name);
		fs.writeFileSync(file, content);
		return vscode.workspace.openTextDocument(file);
	}

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
			const document = await openFile(name, '[package]\nname = "demo"\n');
			assert.strictEqual(document.languageId, 'toml', name);
		}
	});

	test('Toggle Line Comment uses #', async () => {
		const editor = await vscode.window.showTextDocument(await openFile('comment.toml', 'opt-level = 3\n'));
		editor.selection = new vscode.Selection(0, 0, 0, 0);

		await vscode.commands.executeCommand('editor.action.commentLine');

		assert.strictEqual(editor.document.lineAt(0).text, '# opt-level = 3');
		await vscode.commands.executeCommand('workbench.action.files.revert');
	});

	test('comment tags read # comments in TOML', () => {
		assert.deepStrictEqual(getLanguageConfig('toml'), { singleLine: '#' });
	});

	suite('folding', () => {
		test('folds tables, nested tables, multi-line values and comment blocks', () => {
			assert.deepStrictEqual(computeFoldingRanges(scanToml(SAMPLE)), [
				{ start: 0, end: 1, kind: 'comment' },
				{ start: 2, end: 13 }, // [workspace] covers [workspace.package]
				{ start: 3, end: 5 }, // members: the closing ] stays visible
				{ start: 9, end: 13 }, // the comment above it belongs to this header, not [workspace]
				{ start: 11, end: 12 }, // """ string; [not.a.table] inside it is text
				{ start: 15, end: 17 },
			]);
		});

		test('a table section stops before the comment that describes the next header', () => {
			const text = '[a]\nx = 1\n# commented = "out"\n\n# about b\n[b]\ny = 2\n';
			assert.deepStrictEqual(computeFoldingRanges(scanToml(text)), [
				{ start: 0, end: 2 },
				{ start: 5, end: 6 },
			]);
		});

		test('handles CRLF line endings', () => {
			const text = '[a]\r\nx = [\r\n  1,\r\n]\r\n\r\n[b]\r\ny = 2\r\n';
			assert.deepStrictEqual(computeFoldingRanges(scanToml(text)), [
				{ start: 0, end: 3 },
				{ start: 1, end: 2 },
				{ start: 5, end: 6 },
			]);
		});

		test('the folding provider is registered for TOML', async () => {
			const document = await openFile('fold.toml', SAMPLE);
			const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
				'vscode.executeFoldingRangeProvider',
				document.uri,
			);
			assert.ok(
				ranges.some((range) => range.start === 2 && range.end === 13),
				JSON.stringify(ranges),
			);
		});
	});

	suite('outline', () => {
		test('mirrors the document structure', () => {
			const outline = buildOutline(scanToml(SAMPLE));
			assert.strictEqual(
				shape(outline),
				'workspace(members,package(version,notes)),profile.release(lto,opt(level,debug))',
			);
			const workspace = find(outline, 'workspace');
			assert.strictEqual(workspace.kind, 'table');
			assert.strictEqual(find(workspace.children, 'members').detail, '["apps/*", "crates/*"]');
			assert.strictEqual(find(find(outline, 'profile.release').children, 'opt').kind, 'inlineTable');
		});

		test('numbers [[array tables]] and restarts nested numbering', () => {
			const text = '[[bin]]\nname = "a"\n[[bin.x]]\n[[bin.x]]\n[[bin]]\nname = "b"\n[[bin.x]]\n';
			const outline = buildOutline(scanToml(text));
			assert.deepStrictEqual(
				outline.map((node) => [node.name, node.detail, node.children.filter((c) => c.kind === 'arrayTable').map((c) => c.detail)]),
				[
					['bin', '[0]', ['[0]', '[1]']],
					['bin', '[1]', ['[0]']],
				],
			);
		});

		test('ignores # and [ inside strings and keeps quoted keys', () => {
			const outline = buildOutline(scanToml('title = "x # y [z]"\n"a.b" = 1 # trailing\n'));
			assert.strictEqual(shape(outline), 'title,"a.b"');
			assert.strictEqual(outline[0].detail, '"x # y [z]"');
		});

		test('stays usable while a value is still being typed', () => {
			const text = 'a = [1, 2,\n\n[next]\nkey = "v"\nhalf =\n';
			const model = scanToml(text);
			assert.strictEqual(shape(buildOutline(model)), 'a,next(key,half)');
			assert.strictEqual(find(buildOutline(model), 'a').range.end, text.indexOf('\n'));
		});

		test('the document symbol provider is registered for TOML', async () => {
			const document = await openFile('outline.toml', SAMPLE);
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				'vscode.executeDocumentSymbolProvider',
				document.uri,
			);
			assert.strictEqual(
				shape(symbols),
				'workspace(members,package(version,notes)),profile.release(lto,opt(level,debug))',
			);
			assert.strictEqual(symbols[0].kind, vscode.SymbolKind.Object);
		});
	});

	suite('validation', () => {
		test('accepts valid TOML 1.1, including 64-bit integers and multi-line inline tables', async () => {
			assert.strictEqual(await validateToml(SAMPLE), undefined);
			assert.strictEqual(await validateToml('x = 9223372036854775807\n'), undefined);
			assert.strictEqual(await validateToml('a = {\n  b = 1,\n}\n'), undefined);
		});

		test('reports the first error with its line and a short message', async () => {
			const duplicate = await validateToml('a = 1\na = 2\n');
			assert.strictEqual(duplicate?.line, 2);
			assert.match(duplicate?.message ?? '', /^[A-Z].*redefine/);
			assert.ok(!duplicate?.message.includes('\n'));
			assert.strictEqual((await validateToml('a = "unclosed\nb = 1\n'))?.line, 1);
		});

		test('shows a syntax error and clears it once fixed', async () => {
			const document = await openFile('broken.toml', 'name = "unclosed\n');
			const [diagnostic] = await waitFor(
				() => (tomlDiagnostics(document.uri).length > 0 ? tomlDiagnostics(document.uri) : undefined),
				'a TOML diagnostic',
			);
			assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error);
			assert.strictEqual(diagnostic.range.start.line, 0);

			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), 'name = "closed"\n');
			await vscode.workspace.applyEdit(edit);
			await waitFor(() => (tomlDiagnostics(document.uri).length === 0 ? true : undefined), 'the diagnostic to clear');
			await vscode.commands.executeCommand('workbench.action.files.revert');
		});

		test('skips lock files', async () => {
			const lock = await openFile('Cargo.lock', 'name = "unclosed\n');
			const control = await openFile('control.toml', 'name = "unclosed\n');
			await waitFor(() => (tomlDiagnostics(control.uri).length > 0 ? true : undefined), 'the control diagnostic');
			assert.deepStrictEqual(tomlDiagnostics(lock.uri), []);
		});

		test('can be turned off in settings', async () => {
			const document = await openFile('setting.toml', 'a =\n');
			await waitFor(() => (tomlDiagnostics(document.uri).length > 0 ? true : undefined), 'a TOML diagnostic');
			const config = vscode.workspace.getConfiguration();
			try {
				await config.update(VALIDATION_SETTING, false, vscode.ConfigurationTarget.Global);
				await waitFor(() => (tomlDiagnostics(document.uri).length === 0 ? true : undefined), 'diagnostics to clear');
			} finally {
				await config.update(VALIDATION_SETTING, undefined, vscode.ConfigurationTarget.Global);
			}
			await waitFor(() => (tomlDiagnostics(document.uri).length > 0 ? true : undefined), 'the diagnostic to return');
		});
	});

	suite('conversion', () => {
		test('TOML to JSON keeps big integers and turns dates into strings', async () => {
			const result = await tomlToJson('big = 9223372036854775807\nwhen = 1979-05-27\n[t]\nx = [1, 2]\n');
			assert.ok(result.ok);
			assert.ok(result.text.includes('"big": 9223372036854775807'), result.text);
			const data = JSON.parse(result.text) as { when: string; t: { x: number[] } };
			assert.strictEqual(data.when, '1979-05-27');
			assert.deepStrictEqual(data.t.x, [1, 2]);
		});

		test('JSON to TOML round-trips an object', async () => {
			const source = { name: 'demo', deps: { a: { path: 'crates/a' } }, bin: [{ name: 'x' }, { name: 'y' }] };
			const toml = await jsonToToml(JSON.stringify(source));
			assert.ok(toml.ok);
			const back = await tomlToJson(toml.text);
			assert.ok(back.ok);
			assert.deepStrictEqual(JSON.parse(back.text), source);
		});

		test('explains JSON that TOML cannot hold', async () => {
			const notObject = await jsonToToml('[1, 2]');
			assert.ok(!notObject.ok && notObject.reason === 'notAnObject');
			const nullItem = await jsonToToml('{"a": [1, null]}');
			assert.ok(!nullItem.ok && nullItem.reason === 'unsupported');
			const invalid = await jsonToToml('{oops');
			assert.ok(!invalid.ok && invalid.reason === 'invalidJson');
			const badToml = await tomlToJson('a = 1\na = 2\n');
			assert.ok(!badToml.ok && badToml.reason === 'invalidToml' && badToml.error.line === 2);
		});

		test('Copy as JSON and Paste JSON as TOML use the clipboard', async () => {
			const original = await vscode.env.clipboard.readText();
			try {
				const editor = await vscode.window.showTextDocument(await openFile('copy.toml', 'a = 1\n[t]\nb = "x"\n'));
				await vscode.commands.executeCommand(COPY_AS_JSON);
				assert.deepStrictEqual(JSON.parse(await vscode.env.clipboard.readText()), { a: 1, t: { b: 'x' } });

				await vscode.env.clipboard.writeText('{"c": [1, 2]}');
				editor.selection = new vscode.Selection(3, 0, 3, 0);
				await vscode.commands.executeCommand(PASTE_AS_TOML);
				assert.strictEqual(editor.document.lineAt(3).text, 'c = [ 1, 2 ]');
				await vscode.commands.executeCommand('workbench.action.files.revert');
			} finally {
				await vscode.env.clipboard.writeText(original);
			}
		});
	});
});
