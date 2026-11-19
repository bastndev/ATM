import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CrateTarget, FileTarget, findFileTarget, ProjectFiles } from '../extensions/32-rust/core/cargoTarget';
import { readEdition } from '../extensions/32-rust/core/edition';
import { tokenizeRust } from '../extensions/32-rust/core/lexer';
import { findLetTypeHints } from '../extensions/32-rust/core/literalTypes';
import { findMutableSpans } from '../extensions/32-rust/core/mutables';
import { buildRunnable, commandLine, isRunnable, runnableToProcess } from '../extensions/32-rust/core/runnables';
import { findRunTargets, RunTarget } from '../extensions/32-rust/core/runTargets';
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

/** `kind path@line` for every Run button, in order. */
function buttons(source: string): string[] {
	return findRunTargets(tokenizeRust(source)).map(
		(target) => `${target.kind} ${target.path.join('::')}@${source.slice(0, target.offset).split('\n').length - 1}`,
	);
}

/** A project that exists only in memory; keys are paths relative to `root`. */
function memoryProject(root: string, project: Record<string, string>): ProjectFiles {
	const files = new Map(Object.entries(project).map(([file, text]) => [path.join(root, ...file.split('/')), text]));
	return { read: async (file) => files.get(file) };
}

/** `kind:name module::path` for the target a file belongs to, or `none`. */
async function targetOf(root: string, files: ProjectFiles, file: string): Promise<string> {
	const found = await findFileTarget(path.join(root, ...file.split('/')), files);
	if (!found) {
		return 'none';
	}
	const { kind, name, requiredFeatures, harness } = found.target;
	const extras = [...requiredFeatures.map((feature) => `+${feature}`), ...(harness ? [] : ['no-harness'])];
	return [`${kind}:${name}`, found.modulePath.join('::'), ...extras].filter((part) => part.length > 0).join(' ');
}

/** The cargo command a button runs, or undefined when it shows no button. */
function commandFor(target: RunTarget, crate: Partial<CrateTarget> & Pick<CrateTarget, 'kind' | 'name'>, modulePath: string[] = []): string | undefined {
	const file: FileTarget = {
		packageName: 'app',
		packageDir: '/work/app',
		target: { requiredFeatures: [], harness: true, ...crate },
		modulePath,
	};
	const runnable = buildRunnable(target, file);
	return runnable && commandLine(runnable);
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

	suite('type hints', () => {
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

	suite('mut underline', () => {
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

	suite('Run buttons', () => {
		test('finds main(), tests and the modules that hold them', () => {
			const source = [
				'fn main() {', // 0
				'    println!("#[test] fn in_a_string() {}");', // 1
				'}', // 2
				'// #[test] fn commented_out() {}', // 3
				'#[cfg(test)]', // 4
				'mod tests {', // 5
				'    use super::*;', // 6
				'    #[test]', // 7
				'    fn adds() {}', // 8
				'    #[tokio::test(flavor = "multi_thread")]', // 9
				'    pub(crate) async fn fetches() {}', // 10
				'    #[test]', // 11
				'    #[should_panic(expected = "boom")]', // 12
				'    fn panics() {}', // 13
				'    mod nested {', // 14
				'        #[test]', // 15
				'        fn deep() {}', // 16
				'    }', // 17
				'    fn helper() {}', // 18
				'}', // 19
			].join('\n');
			assert.deepStrictEqual(buttons(source), [
				'main @0',
				'testModule tests@5',
				'test tests::adds@8',
				'test tests::fetches@10',
				'test tests::panics@13',
				'testModule tests::nested@14',
				'test tests::nested::deep@16',
			]);
		});

		test('skips what cargo cannot run on its own', () => {
			const source = [
				'mod app {', // a main() inside a module is not the program's entry point
				'    fn main() {}',
				'}',
				'fn outer() {', // the test runner never sees tests inside a function
				'    #[test]',
				'    fn inner() {}',
				'}',
				'impl Point {',
				'    #[test]',
				'    fn method() {}',
				'}',
				'#[cfg(test)]', // `cfg(test)` is not a test attribute
				'struct Fixture;',
				'fn after_struct() {}',
				'mod helpers {',
				'    #![cfg(test)]', // an inner attribute belongs to the module
				'    fn build() {}',
				'}',
				'#[test_case(1)]', // only attributes ending in `test` mark a test
				'fn case() {}',
			].join('\n');
			assert.deepStrictEqual(buttons(source), []);
		});

		test('knows which cargo target each file belongs to', async () => {
			const root = path.join(os.tmpdir(), 'atm-rust-layout');
			const files = memoryProject(root, {
				'Cargo.toml': [
					'[package]',
					'name = "app"',
					'version = "0.1.0"',
					'',
					'[[bin]]',
					'name = "server"',
					'path = "cmd/server.rs"',
					'required-features = ["net"]',
					'',
					'[[test]]',
					'name = "smoke"',
					'path = "checks/smoke.rs"',
					'harness = false',
				].join('\n'),
				'build.rs': 'fn main() {}',
				'src/main.rs': 'mod cli;\nfn main() {}',
				'src/lib.rs': 'pub mod utils;\n#[cfg(test)]\nmod tests { }',
				'src/cli.rs': '',
				'src/utils/mod.rs': 'pub mod math;',
				'src/utils/math.rs': '',
				'src/orphan.rs': '',
				'src/bin/tool.rs': '',
				'src/bin/multi/main.rs': 'mod helper;\nfn main() {}',
				'src/bin/multi/helper.rs': '',
				'examples/demo.rs': '',
				'tests/api.rs': '',
				'tests/common/mod.rs': '',
				'cmd/server.rs': '',
				'checks/smoke.rs': '',
			});
			const expected: Record<string, string> = {
				'src/main.rs': 'bin:app',
				'src/lib.rs': 'lib:app',
				'src/cli.rs': 'bin:app cli', // declared by main.rs only
				'src/utils/mod.rs': 'lib:app utils',
				'src/utils/math.rs': 'lib:app utils::math',
				'src/orphan.rs': 'none', // no `mod orphan;` anywhere, so cargo never compiles it
				'src/bin/tool.rs': 'bin:tool',
				'src/bin/multi/main.rs': 'bin:multi',
				'src/bin/multi/helper.rs': 'bin:multi helper',
				'examples/demo.rs': 'example:demo',
				'tests/api.rs': 'test:api',
				'tests/common/mod.rs': 'none', // shared code for tests, not a test of its own
				'cmd/server.rs': 'bin:server +net',
				'checks/smoke.rs': 'test:smoke no-harness',
				'build.rs': 'none',
			};
			for (const [file, target] of Object.entries(expected)) {
				assert.strictEqual(await targetOf(root, files, file), target, file);
			}
			assert.strictEqual(await findFileTarget(path.join(os.tmpdir(), 'atm-rust-loose', 'main.rs'), files), undefined, 'no Cargo.toml above');
		});

		test('handles workspaces and turned-off auto discovery', async () => {
			const root = path.join(os.tmpdir(), 'atm-rust-workspace');
			const files = memoryProject(root, {
				'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
				'stray.rs': 'fn main() {}',
				'crates/engine/Cargo.toml': '[package]\nname = "engine"\nversion = "0.1.0"\nautobins = false\n',
				'crates/engine/src/lib.rs': '#[cfg(test)]\nmod tests;\n',
				'crates/engine/src/tests.rs': '',
				'crates/engine/src/bin/extra.rs': 'fn main() {}',
			});
			assert.strictEqual(await targetOf(root, files, 'crates/engine/src/tests.rs'), 'lib:engine tests');
			assert.strictEqual(await targetOf(root, files, 'crates/engine/src/bin/extra.rs'), 'none', 'autobins = false');
			assert.strictEqual(await targetOf(root, files, 'stray.rs'), 'none', 'a workspace-only Cargo.toml has no package');
			const found = await findFileTarget(path.join(root, 'crates', 'engine', 'src', 'lib.rs'), files);
			assert.strictEqual(found?.packageDir, path.join(root, 'crates', 'engine'), 'cargo runs in the package folder');
		});

		test('builds the same cargo commands as rust-analyzer', () => {
			const main: RunTarget = { kind: 'main', offset: 0, path: [] };
			const adds: RunTarget = { kind: 'test', offset: 0, path: ['tests', 'adds'] };
			const tests: RunTarget = { kind: 'testModule', offset: 0, path: ['tests'] };

			assert.strictEqual(commandFor(main, { kind: 'bin', name: 'app' }), 'cargo run --package app --bin app');
			assert.strictEqual(commandFor(main, { kind: 'example', name: 'demo' }), 'cargo run --package app --example demo');
			assert.strictEqual(commandFor(main, { kind: 'test', name: 'smoke', harness: false }), 'cargo test --package app --test smoke');
			assert.strictEqual(commandFor(main, { kind: 'lib', name: 'app' }), undefined, 'a library has no program to run');
			assert.strictEqual(commandFor(main, { kind: 'bin', name: 'app' }, ['cli']), undefined, 'main() in a module file');
			assert.strictEqual(commandFor(main, { kind: 'test', name: 'api' }), undefined, 'the test harness brings its own main()');

			assert.strictEqual(
				commandFor(adds, { kind: 'lib', name: 'app' }, ['utils']),
				'cargo test --package app --lib -- utils::tests::adds --exact --nocapture --include-ignored',
			);
			assert.strictEqual(
				commandFor(adds, { kind: 'bin', name: 'server', requiredFeatures: ['net', 'tls'] }),
				'cargo test --package app --bin server --features net,tls -- tests::adds --exact --nocapture --include-ignored',
			);
			assert.strictEqual(commandFor(tests, { kind: 'lib', name: 'app' }), 'cargo test --package app --lib -- tests:: --nocapture');
			assert.strictEqual(commandFor(adds, { kind: 'test', name: 'smoke', harness: false }), undefined, 'no harness, no tests');
		});

		test('turns a runnable into the cargo process', () => {
			const runnable = { label: 'test tests::adds', cwd: '/work/app', cargoArgs: ['test', '--lib'], executableArgs: ['tests::adds', '--exact'] };
			assert.ok(isRunnable(runnable));
			assert.ok(!isRunnable({ label: 'run app' }), 'arguments from elsewhere are checked');
			assert.ok(!isRunnable({ ...runnable, cargoArgs: [] }));
			assert.deepStrictEqual(runnableToProcess(runnable, '/home/me/.cargo/bin/cargo'), {
				command: '/home/me/.cargo/bin/cargo',
				args: ['test', '--lib', '--', 'tests::adds', '--exact'],
				cwd: '/work/app',
				env: { RUST_BACKTRACE: 'short' },
			});
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
