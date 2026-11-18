import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { renameServerCommand } from '../extensions/32-rust/core/commandMap';
import { readEdition } from '../extensions/32-rust/core/edition';
import { tokenizeRust } from '../extensions/32-rust/core/lexer';
import { findLetTypeHints } from '../extensions/32-rust/core/literalTypes';
import { findMutableSpans } from '../extensions/32-rust/core/mutables';
import { runnableToProcess } from '../extensions/32-rust/core/runnables';
import { buildServerConfig } from '../extensions/32-rust/core/serverConfig';
import { findTool } from '../extensions/32-rust/host/toolchain';
import { CARGO_TASK_TYPE, CargoTaskProvider } from '../extensions/32-rust/providers/cargoTasks';
import { findEdition } from '../extensions/32-rust/providers/rustfmt';

const extensionId = 'bastndev.atm';

/** `name: type` for every hint, in order. */
function hintsFor(source: string): string[] {
	return findLetTypeHints(tokenizeRust(source)).map((hint) => {
		const before = source.slice(0, hint.offset);
		const name = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before)?.[1] ?? '?';
		return `${name}${hint.label}`;
	});
}

/** The underlined text, with the line it is on: `name@line`. */
function underlined(source: string): string[] {
	return findMutableSpans(tokenizeRust(source))
		.sort((a, b) => a.start - b.start)
		.map((span) => `${source.slice(span.start, span.end)}@${source.slice(0, span.start).split('\n').length - 1}`);
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await probe();
		if (value !== undefined) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return undefined;
}

suite('Rust Test Suite', () => {
	suite('tokenizer', () => {
		test('skips comments and keeps strings, chars and lifetimes whole', () => {
			const source = [
				'// let x = 1;',
				'/* outer /* nested */ still comment */',
				'fn f<\'a>(s: &\'a str) -> char { let c = \'x\'; let q = \'\\\'\'; let r = r#"say "hi""#; c }',
			].join('\n');
			const tokens = tokenizeRust(source);
			assert.ok(!tokens.some((token) => token.text === 'x' && token.kind === 'ident'), 'comment text is not code');
			assert.deepStrictEqual(
				tokens.filter((token) => token.kind === 'lifetime').map((token) => token.text),
				["'a", "'a"],
			);
			assert.deepStrictEqual(
				tokens.filter((token) => token.kind === 'char').map((token) => token.text),
				["'x'", "'\\''"],
			);
			assert.deepStrictEqual(
				tokens.filter((token) => token.kind === 'string').map((token) => token.text),
				['r#"say "hi""#'],
			);
		});

		test('reads ranges, method calls on numbers and tuple fields correctly', () => {
			const texts = (source: string) => tokenizeRust(source).map((token) => token.text);
			assert.deepStrictEqual(texts('0..10'), ['0', '..', '10']);
			assert.deepStrictEqual(texts('1.max(2)'), ['1', '.', 'max', '(', '2', ')']);
			assert.deepStrictEqual(texts('6.5f32 1e10 0xffu8 1_000'), ['6.5f32', '1e10', '0xffu8', '1_000']);
		});
	});

	suite('type hints without rust-analyzer', () => {
		test('shows the type of simple values', () => {
			const source = [
				'let my_float = 6.5;',
				'let mut my_bool = false;',
				'let mut my_int = 7;',
				'let name = "Brais";',
				'let letter = \'a\';',
				'let byte = b\'a\';',
				'let small = 3u8;',
				'let neg = -2.5;',
				'let owned = String::from("x");',
				'let empty = String::new();',
				'let text = "x".to_string();',
				'let message = format!("{}", name);',
				'let my_list = vec!["Brais", "Moure"];',
				'let zeros = vec![0u8; 16];',
				'let grid = [1, 2, 3];',
				'let repeated = [0.0; 4];',
				'let pair = (1, "one");',
				'let mixed = vec![1, 2u64, 3];',
			].join('\n');
			assert.deepStrictEqual(hintsFor(source), [
				'my_float: f64',
				'my_bool: bool',
				'my_int: i32',
				'name: &str',
				'letter: char',
				'byte: u8',
				'small: u8',
				'neg: f64',
				'owned: String',
				'empty: String',
				'text: String',
				'message: String',
				'my_list: Vec<&str>',
				'zeros: Vec<u8>',
				'grid: [i32; 3]',
				'repeated: [f64; 4]',
				'pair: (i32, &str)',
				'mixed: Vec<u64>',
			]);
		});

		test('stays quiet when the type is not obvious', () => {
			const source = [
				'let typed: f32 = 6.5;',
				'let called = compute();',
				'let math = 1 + 2;',
				'let nothing = vec![];',
				'let clash = vec![1, 2.0];',
				'let Some(x) = maybe else { return; };',
				'let _ = 5;',
				'let (a, b) = (1, 2);',
				'let field = point.x;',
			].join('\n');
			assert.deepStrictEqual(hintsFor(source), []);
		});
	});

	suite('mut underline without rust-analyzer', () => {
		test('underlines the declaration and every use in scope', () => {
			const source = [
				'fn main() {', // 0
				'    let mut my_int = 7;', // 1
				'    my_int = my_int + 4;', // 2
				'    println!("{my_int}");', // 3
				'    let fixed = 1;', // 4
				'    other(fixed);', // 5
				'}', // 6
				'fn other(my_int: i32) { my_int; }', // 7
			].join('\n');
			assert.deepStrictEqual(underlined(source), ['my_int@1', 'my_int@2', 'my_int@2']);
		});

		test('ignores borrows, fields and paths, and stops at shadowing', () => {
			const source = [
				'fn main() {', // 0
				'    let mut v = Vec::new();', // 1
				'    push(&mut v);', // 2
				'    self.v; Point { v: 1 }; v::thing();', // 3
				'    { let v = 2; v; }', // 4
				'    v.push(1);', // 5
				'    let v = 3;', // 6
				'    v;', // 7
				'}', // 8
			].join('\n');
			assert.deepStrictEqual(underlined(source), ['v@1', 'v@2', 'v@5']);
		});

		test('handles parameters, if let and for loops', () => {
			const source = [
				'fn add(mut total: i32, step: i32) -> i32 { total += step; total }', // 0
				'fn read() { if let Some(mut line) = next() { line.push(1); } line; }', // 1
				'fn each() { for mut item in items() { item += 1; } }', // 2
			].join('\n');
			assert.deepStrictEqual(underlined(source), [
				'total@0',
				'total@0',
				'total@0',
				'line@1',
				'line@1',
				'item@2',
				'item@2',
			]);
		});
	});

	suite('rustfmt edition', () => {
		test('reads direct and inherited editions', () => {
			assert.deepStrictEqual(readEdition('[package]\nname = "a"\nedition = "2024"\n'), { edition: '2024' });
			assert.deepStrictEqual(readEdition('[package]\nedition.workspace = true\n'), { inherited: true });
			assert.deepStrictEqual(readEdition('[package]\nedition = { workspace = true }\n'), { inherited: true });
			assert.strictEqual(readEdition('[package]\nname = "a"\n'), undefined);
		});

		test('follows workspace inheritance up to the root Cargo.toml', async () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-rust-edition-'));
			try {
				fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["app"]\n[workspace.package]\nedition = "2024"\n');
				fs.mkdirSync(path.join(root, 'app', 'src'), { recursive: true });
				fs.writeFileSync(path.join(root, 'app', 'Cargo.toml'), '[package]\nname = "app"\nedition.workspace = true\n');
				fs.mkdirSync(path.join(root, 'old', 'src'), { recursive: true });
				fs.writeFileSync(path.join(root, 'old', 'Cargo.toml'), '[package]\nname = "old"\n');

				assert.strictEqual(await findEdition(path.join(root, 'app', 'src')), '2024');
				assert.strictEqual(await findEdition(path.join(root, 'old', 'src')), '2015');
			} finally {
				fs.rmSync(root, { recursive: true, force: true });
			}
		});
	});

	suite('rust-analyzer connection', () => {
		test('turns a Run button into the cargo command', () => {
			const spec = runnableToProcess(
				{
					label: 'test tests::adds',
					kind: 'cargo',
					args: {
						workspaceRoot: '/project',
						cwd: '/project/crate',
						cargoArgs: ['test', '--package', 'app', '--lib'],
						executableArgs: ['tests::adds', '--exact'],
						environment: { APP_MODE: 'test' },
					},
				},
				'/home/me/.cargo/bin/cargo',
			);
			assert.deepStrictEqual(spec, {
				command: '/home/me/.cargo/bin/cargo',
				args: ['test', '--package', 'app', '--lib', '--', 'tests::adds', '--exact'],
				cwd: '/project',
				env: { RUST_BACKTRACE: 'short', APP_MODE: 'test' },
			});
		});

		test('sends ATM settings in the shape rust-analyzer reads', () => {
			const config = buildServerConfig({ checkCommand: 'clippy', typeHints: true, parameterHints: false }) as {
				check: { command: string };
				inlayHints: { typeHints: { enable: boolean }; parameterHints: { enable: boolean } };
				lens: { run: { enable: boolean }; debug: { enable: boolean } };
			};
			assert.strictEqual(config.check.command, 'clippy');
			assert.strictEqual(config.inlayHints.typeHints.enable, true);
			assert.strictEqual(config.inlayHints.parameterHints.enable, false);
			assert.strictEqual(config.lens.run.enable, true);
			assert.strictEqual(config.lens.debug.enable, false);
		});

		test('renames server commands to ATM commands', () => {
			assert.strictEqual(renameServerCommand({ command: 'rust-analyzer.runSingle' })?.command, 'atm.rust.runSingle');
			assert.strictEqual(renameServerCommand({ command: 'editor.action.rename' })?.command, 'editor.action.rename');
		});

		test('every command rust-analyzer can send is registered', async () => {
			const extension = vscode.extensions.getExtension(extensionId);
			await extension?.activate();
			const commands = await vscode.commands.getCommands(true);
			for (const id of [
				'atm.rust.runSingle',
				'atm.rust.showReferences',
				'atm.rust.gotoLocation',
				'atm.rust.triggerParameterHints',
				'atm.rust.rename',
				'atm.rust.openDocs',
				'atm.rust.restartServer',
				'atm.rust.installServer',
			]) {
				assert.ok(commands.includes(id), `${id} is registered`);
			}
		});
	});

	suite('package.json', () => {
		test('declares the Rust settings, tasks, error matchers and the mut underline', () => {
			const extension = vscode.extensions.getExtension(extensionId);
			assert.ok(extension, 'ATM is installed in the test host');
			const contributes = extension.packageJSON.contributes;
			const settings = contributes.configuration.properties;
			for (const key of [
				'atm.rust.enabled',
				'atm.rust.serverPath',
				'atm.rust.checkOnSave.command',
				'atm.rust.inlayHints.typeHints',
				'atm.rust.inlayHints.parameterHints',
			]) {
				assert.ok(settings[key], `${key} is declared`);
			}
			assert.strictEqual(settings['atm.rust.serverPath'].scope, 'machine', 'a workspace cannot pick the program to run');
			assert.ok(contributes.taskDefinitions.some((definition: { type: string }) => definition.type === 'atm-cargo'));
			assert.ok(contributes.problemMatchers.some((matcher: { name: string }) => matcher.name === 'atm-rustc'));
			assert.ok(contributes.problemPatterns.some((pattern: { name: string }) => pattern.name === 'atm-rustc'));
			const rustScopes = contributes.semanticTokenScopes.find((entry: { language: string }) => entry.language === 'rust');
			assert.deepStrictEqual(rustScopes.scopes['*.mutable'], ['markup.underline']);
			assert.strictEqual(contributes.configurationDefaults['[rust]']['editor.formatOnSave'], true);
			// Antigravity hides inlay hints by default (offUnlessPressed); Rust files show them.
			assert.strictEqual(contributes.configurationDefaults['[rust]']['editor.inlayHints.enabled'], 'on');
		});
	});

	suite('in the editor', () => {
		let folder: string;
		let file: string;

		suiteSetup(() => {
			folder = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-rust-editor-'));
			fs.writeFileSync(path.join(folder, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n');
			fs.mkdirSync(path.join(folder, 'src'));
			file = path.join(folder, 'src', 'main.rs');
		});

		suiteTeardown(async () => {
			await vscode.workspace.getConfiguration('atm.rust').update('serverPath', undefined, vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(folder, { recursive: true, force: true });
		});

		test('formats with rustfmt', async function () {
			this.timeout(30_000);
			if (!(await findTool('rustfmt', folder))) {
				this.skip();
			}
			fs.writeFileSync(file, 'async fn  main( ){let x=1;}\n');
			const document = await vscode.workspace.openTextDocument(file);
			await vscode.window.showTextDocument(document);
			const edits = await waitFor(async () => {
				const result = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, {
					tabSize: 4,
					insertSpaces: true,
				});
				return result && result.length > 0 ? result : undefined;
			}, 15_000);
			assert.ok(edits, 'rustfmt returned edits');
			const edit = new vscode.WorkspaceEdit();
			edit.set(document.uri, edits);
			await vscode.workspace.applyEdit(edit);
			assert.strictEqual(document.getText(), 'async fn main() {\n    let x = 1;\n}\n');
			await vscode.commands.executeCommand('workbench.action.files.revert');
		});

		test('shows exact types from rust-analyzer when ATM_RUST_SERVER points to it', async function () {
			const server = process.env.ATM_RUST_SERVER;
			if (!server) {
				this.skip();
			}
			this.timeout(240_000);
			fs.writeFileSync(
				file,
				[
					'fn make() -> Vec<u16> { Vec::new() }', // 0
					'fn area(width: u32, height: u32) -> u32 { width * height }', // 1
					'fn main() {', // 2
					'    let made = make();', // 3
					'    let mut count = 6.5;', // 4
					'    count += 1.0;', // 5
					'    area(800, 600);', // 6
					'}', // 7
					'#[test]', // 8
					'fn adds() { assert_eq!(area(2, 3), 6); std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/ran.txt"), "ok").unwrap(); }', // 9
					'',
				].join('\n'),
			);
			await vscode.workspace.getConfiguration('atm.rust').update('serverPath', server, vscode.ConfigurationTarget.Global);
			const document = await vscode.workspace.openTextDocument(file);
			await vscode.window.showTextDocument(document);
			const labels = await waitFor(async () => {
				const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
					'vscode.executeInlayHintProvider',
					document.uri,
					document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)),
				);
				const text = (hints ?? []).map((hint) =>
					typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join(''),
				);
				return text.some((label) => label.includes('Vec<u16>')) && text.some((label) => label.includes('width')) ? text : undefined;
			}, 110_000);
			assert.ok(labels, 'rust-analyzer sent the type of make() and the parameter names');
			assert.strictEqual(
				labels.filter((label) => label.includes('f64')).length,
				1,
				'the simple type guesses are off while rust-analyzer runs, so `count` has one hint',
			);

			// ▶ Run above main() and ▶ Run Test above the test, answered by ATM's command.
			const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri, 10);
			const runLenses = (lenses ?? []).filter((lens) => lens.command?.command === 'atm.rust.runSingle');
			assert.ok(runLenses.some((lens) => lens.range.start.line === 2), 'Run button above main()');
			assert.ok(runLenses.some((lens) => lens.range.start.line === 9), 'Run Test button above the test');
			assert.ok(!(lenses ?? []).some((lens) => lens.command?.command.startsWith('rust-analyzer.')), 'no rust-analyzer.* command is left');

			// Hover and Ctrl+click.
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, new vscode.Position(3, 16));
			const hoverText = (hovers ?? [])
				.flatMap((hover) => hover.contents)
				.map((content) => (typeof content === 'string' ? content : content.value))
				.join('\n');
			assert.ok(hoverText.includes('fn make() -> Vec<u16>'), 'hover shows the signature');
			const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
				'vscode.executeDefinitionProvider',
				document.uri,
				new vscode.Position(3, 16),
			);
			const target = definitions?.[0];
			const targetRange = target && 'targetRange' in target ? target.targetRange : target?.range;
			assert.strictEqual(targetRange?.start.line, 0, 'Ctrl+click on make() jumps to its definition');

			// The `mut` underline comes from the `mutable` semantic modifier.
			const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', document.uri);
			const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', document.uri);
			const mutableBit = legend ? legend.tokenModifiers.indexOf('mutable') : -1;
			assert.ok(mutableBit >= 0, 'rust-analyzer marks mutable variables');
			const mutableLines = new Set<number>();
			let line = 0;
			for (let i = 0; tokens && i < tokens.data.length; i += 5) {
				line += tokens.data[i];
				if (tokens.data[i + 4] & (1 << mutableBit)) {
					mutableLines.add(line);
				}
			}
			assert.ok(mutableLines.has(4) && mutableLines.has(5), '`count` is mutable where it is declared and used');

			// Clicking ▶ Run Test runs `cargo test` for that test and it passes. With no folder
			// open (as in this test window) it runs in a terminal instead of a task.
			const runTest = runLenses.find((lens) => lens.range.start.line === 9);
			assert.ok(runTest?.command);
			await vscode.commands.executeCommand(runTest.command.command, ...(runTest.command.arguments ?? []));
			const ran = await waitFor(async () => (fs.existsSync(path.join(folder, 'ran.txt')) ? true : undefined), 200_000);
			assert.ok(ran, 'cargo test ran the test');
			assert.ok(
				vscode.window.terminals.some((terminal) => terminal.name === 'test adds'),
				'the terminal stays open so the output can be read',
			);
		});

		test('Cargo tasks run cargo in the project folder', async () => {
			const projectFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(folder), name: 'demo', index: 0 };
			const definition = { type: CARGO_TASK_TYPE, command: 'check', cwd: 'src-tauri', args: ['--release'] };
			const task = new vscode.Task(definition, projectFolder, 'cargo check', 'ATM Rust');
			const resolved = await new CargoTaskProvider().resolveTask(task);
			const execution = resolved?.execution as vscode.ProcessExecution | undefined;
			assert.ok(execution, 'the task resolves to a cargo process');
			assert.ok(/cargo(\.exe)?$/.test(execution.process));
			assert.deepStrictEqual(execution.args, ['check', '--release']);
			assert.strictEqual(execution.options?.cwd, path.join(folder, 'src-tauri'));
			assert.deepStrictEqual(resolved?.problemMatchers, ['$atm-rustc']);
		});
	});
});
