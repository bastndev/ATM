import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTool } from '../extensions/32-rust/host/toolchain';
import { LineSplitter, parseBuildLine, pickExecutable, Artifact } from '../extensions/33-cargo/core/buildOutput';
import { appEnvironment } from '../extensions/33-cargo/core/environment';
import { LineInput } from '../extensions/33-cargo/core/lineInput';
import { CargoWorkspace, parseMetadata } from '../extensions/33-cargo/core/metadata';
import { collectProblems, Problem, toProblems } from '../extensions/33-cargo/core/problems';
import { buildArgs, chooseProgram, displayCommand, parseRunArgs, selectionKey } from '../extensions/33-cargo/core/programs';
import { triggersRestart } from '../extensions/33-cargo/core/saveFilter';
import { readWorkspace } from '../extensions/33-cargo/host/cargoTools';
import { CargoRunner, RunnerView } from '../extensions/33-cargo/host/runner';

// This file uses no VS Code API, so it also runs under plain mocha (--ui tdd).

const ROOT = path.resolve('/work/ide');

interface TargetJson {
	kind: string[];
	name: string;
	src: string;
	crateTypes?: string[];
	requiredFeatures?: string[];
}

/** cargo metadata's JSON for packages given as { 'dir/relative/to/ROOT': targets }. */
function metadataJson(packages: Record<string, { name: string; targets: TargetJson[]; defaultRun?: string }>, defaultMembers?: string[]): string {
	const entries = Object.entries(packages).map(([dir, pkg]) => {
		const pkgDir = path.join(ROOT, dir);
		return {
			id: `path+file://${pkgDir}#${pkg.name}@0.1.0`,
			name: pkg.name,
			version: '0.1.0',
			manifest_path: path.join(pkgDir, 'Cargo.toml'),
			default_run: pkg.defaultRun ?? null,
			targets: pkg.targets.map((target) => ({
				kind: target.kind,
				crate_types: target.crateTypes ?? (target.kind.includes('lib') ? ['lib'] : ['bin']),
				name: target.name,
				src_path: path.join(pkgDir, target.src),
				'required-features': target.requiredFeatures,
			})),
		};
	});
	const ids = entries.map((entry) => entry.id);
	return JSON.stringify({
		packages: entries,
		workspace_members: ids,
		workspace_default_members: defaultMembers ? ids.filter((id) => defaultMembers.some((name) => id.includes(`#${name}@`))) : ids,
		target_directory: path.join(ROOT, 'target'),
		workspace_root: ROOT,
		version: 1,
	});
}

/** The user's layout: a virtual workspace with one app and two libraries. */
function exampleIde(): CargoWorkspace {
	const workspace = parseMetadata(
		metadataJson({
			'apps/example-ide': { name: 'example-ide', targets: [{ kind: ['bin'], name: 'example-ide', src: 'src/main.rs' }] },
			'crates/brand': { name: 'ide-brand', targets: [{ kind: ['lib'], name: 'ide_brand', src: 'src/lib.rs' }] },
			'crates/ui': { name: 'ide-ui', targets: [{ kind: ['lib'], name: 'ide_ui', src: 'src/lib.rs' }] },
		}),
	);
	assert.ok(workspace);
	return workspace;
}

/** A workspace with several programs, so nothing is obvious. */
function manyPrograms(): CargoWorkspace {
	const workspace = parseMetadata(
		metadataJson(
			{
				'.': {
					name: 'suite',
					targets: [
						{ kind: ['bin'], name: 'server', src: 'src/main.rs' },
						{ kind: ['bin'], name: 'cli', src: 'src/bin/cli.rs', requiredFeatures: ['cli'] },
						{ kind: ['example'], name: 'demo', src: 'examples/demo.rs' },
						{ kind: ['example'], name: 'plugin', src: 'examples/plugin.rs', crateTypes: ['cdylib'] },
					],
				},
				'tools/gen': { name: 'gen', targets: [{ kind: ['bin'], name: 'gen', src: 'src/main.rs' }] },
			},
			['suite'],
		),
	);
	assert.ok(workspace);
	return workspace;
}

function chosen(workspace: CargoWorkspace, options: Parameters<typeof chooseProgram>[1]): string {
	const choice = chooseProgram(workspace, options);
	switch (choice.kind) {
		case 'selected':
			return selectionKey(choice.selection);
		case 'ask':
			return `ask: ${choice.candidates.map(selectionKey).join(', ')}`;
		default:
			return 'none';
	}
}

function line(value: unknown): string {
	return JSON.stringify(value);
}

function span(file: string, lineStart: number, columnStart: number, extra: Record<string, unknown> = {}) {
	return { file_name: file, line_start: lineStart, line_end: lineStart, column_start: columnStart, column_end: columnStart + 3, is_primary: true, ...extra };
}

function where(problem: Problem): string {
	return `${path.relative(ROOT, problem.file)}:${problem.line}:${problem.column} ${problem.severity}`;
}

class RecordingView implements RunnerView {
	readonly columns = 80;
	text = '';
	events: string[] = [];
	buildStarted(command: string): void {
		this.events.push(`build ${command}`);
	}
	output(text: string): void {
		this.text += text;
	}
	buildFailed(oldProgramRunning: boolean, built: boolean): void {
		this.events.push(`failed old=${oldProgramRunning} built=${built}`);
	}
	programStarted(executable: string): void {
		this.events.push(`started ${executable}`);
	}
	programExited(code: number | null, signal: NodeJS.Signals | null): void {
		this.events.push(`exited ${code} ${signal}`);
	}
	programFailedToStart(message: string): void {
		this.events.push(`error ${message}`);
	}
	stopped(): void {
		this.events.push('stopped');
	}
}

suite('Cargo Run Test Suite', () => {
	suite('cargo metadata', () => {
		test('keeps binaries and runnable examples, and every member is a default member on old cargo', () => {
			const workspace = manyPrograms();
			assert.strictEqual(workspace.root, ROOT);
			assert.strictEqual(workspace.targetDir, path.join(ROOT, 'target'));
			const suite = workspace.packages.find((pkg) => pkg.name === 'suite');
			assert.deepStrictEqual(
				suite?.programs.map((program) => `${program.kind}:${program.name}`),
				['bin:server', 'bin:cli', 'example:demo'],
			);
			assert.deepStrictEqual(suite?.programs[1].requiredFeatures, ['cli']);
			assert.strictEqual(suite?.dir, ROOT);

			const old = JSON.parse(metadataJson({ '.': { name: 'one', targets: [{ kind: ['bin'], name: 'one', src: 'src/main.rs' }] } }));
			delete old.workspace_default_members;
			assert.deepStrictEqual(parseMetadata(JSON.stringify(old))?.defaultMembers, old.workspace_members);
		});

		test('rejects output that is not cargo metadata', () => {
			assert.strictEqual(parseMetadata('error: could not find Cargo.toml'), undefined);
			assert.strictEqual(parseMetadata('{"packages": []}'), undefined);
		});
	});

	suite('choosing the program', () => {
		test('a library file in a workspace with one app runs that app, like cargo run at the top', () => {
			const workspace = exampleIde();
			const lib = path.join(ROOT, 'crates/ui/src/lib.rs');
			assert.strictEqual(chosen(workspace, { file: lib }), 'example-ide/bin/example-ide');
			assert.strictEqual(chosen(workspace, {}), 'example-ide/bin/example-ide');
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'README.md') }), 'example-ide/bin/example-ide');
		});

		test('the open file picks its own program first', () => {
			const workspace = manyPrograms();
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'src/bin/cli.rs') }), 'suite/bin/cli');
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'examples/demo.rs') }), 'suite/example/demo');
			// A module of a package with one binary.
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'tools/gen/src/parse.rs') }), 'gen/bin/gen');
		});

		test('a ▶ Run request wins, then default-run, then the remembered choice, then the user is asked', () => {
			const workspace = manyPrograms();
			assert.strictEqual(chosen(workspace, { request: { packageName: 'suite', kind: 'example', name: 'demo' } }), 'suite/example/demo');
			// Two binaries and no default-run: the remembered one, else ask (default members and binaries first).
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'src/lib.rs'), remembered: 'gen/bin/gen' }), 'gen/bin/gen');
			assert.strictEqual(chosen(workspace, { remembered: 'gone/bin/gone' }), 'ask: suite/bin/server, suite/bin/cli, suite/example/demo, gen/bin/gen');

			const suite = workspace.packages.find((pkg) => pkg.name === 'suite');
			assert.ok(suite);
			suite.defaultRun = 'cli';
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'src/lib.rs') }), 'suite/bin/cli');
			assert.strictEqual(chosen(workspace, {}), 'suite/bin/cli');
		});

		test('a workspace without programs has nothing to run', () => {
			const workspace = parseMetadata(metadataJson({ '.': { name: 'lib', targets: [{ kind: ['lib'], name: 'lib', src: 'src/lib.rs' }] } }));
			assert.ok(workspace);
			assert.strictEqual(chosen(workspace, { file: path.join(ROOT, 'src/lib.rs') }), 'none');
		});

		test('reads the program out of a ▶ Run button command', () => {
			assert.deepStrictEqual(parseRunArgs(['run', '--package', 'app', '--bin', 'tool', '--features', 'x']), { packageName: 'app', kind: 'bin', name: 'tool' });
			assert.deepStrictEqual(parseRunArgs(['run', '-p', 'app', '--example=demo']), { packageName: 'app', kind: 'example', name: 'demo' });
		});

		test('builds only the chosen program, with its required features and the user\'s arguments', () => {
			const workspace = manyPrograms();
			const choice = chooseProgram(workspace, { file: path.join(ROOT, 'src/bin/cli.rs') });
			assert.strictEqual(choice.kind, 'selected');
			if (choice.kind !== 'selected') {
				return;
			}
			const args = buildArgs(choice.selection, ['--release']);
			assert.deepStrictEqual(args, [
				'build',
				'--message-format=json-diagnostic-rendered-ansi',
				'--package',
				'suite',
				'--bin',
				'cli',
				'--features',
				'cli',
				'--release',
			]);
			assert.strictEqual(displayCommand(args), 'cargo build --package suite --bin cli --features cli --release');
		});
	});

	suite('build output', () => {
		test('joins JSON split across chunks and finds the program\'s executable', () => {
			const splitter = new LineSplitter();
			const artifact = line({
				reason: 'compiler-artifact',
				target: { kind: ['bin'], name: 'app' },
				profile: { test: false },
				executable: '/p/target/debug/app',
			});
			const testArtifact = line({ reason: 'compiler-artifact', target: { kind: ['bin'], name: 'app' }, profile: { test: true }, executable: '/p/target/debug/deps/app-123' });
			const lib = line({ reason: 'compiler-artifact', target: { kind: ['lib'], name: 'core' }, profile: { test: false }, executable: null });
			const chunks = [testArtifact + '\n' + artifact.slice(0, 20), artifact.slice(20) + '\r\n' + lib + '\nplain text\n' + line({ reason: 'build-finished', success: true })];

			const lines = [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.end()];
			const events = lines.map(parseBuildLine);
			assert.deepStrictEqual(events.map((event) => event?.type), ['artifact', 'artifact', undefined, 'text', 'finished']);

			const artifacts = events.flatMap((event) => (event?.type === 'artifact' ? [event.artifact] : []));
			assert.strictEqual(pickExecutable(artifacts, { kind: 'bin', name: 'app' }), '/p/target/debug/app');
			assert.strictEqual(pickExecutable(artifacts, { kind: 'example', name: 'app' }), undefined);
			const finished = events[4];
			assert.ok(finished?.type === 'finished' && finished.success);
		});

		test('keeps the coloured compiler text for the terminal', () => {
			const event = parseBuildLine(line({ reason: 'compiler-message', message: { level: 'error', message: 'oops', rendered: '\x1b[31merror\x1b[0m: oops\n', spans: [] } }));
			assert.ok(event?.type === 'message');
			assert.strictEqual(event.rendered, '\x1b[31merror\x1b[0m: oops\n');
			const artifacts: Artifact[] = [];
			assert.strictEqual(pickExecutable(artifacts, { kind: 'bin', name: 'x' }), undefined);
		});
	});

	suite('problems', () => {
		test('points at the line in the workspace, 0-based, with the help lines and the error code', () => {
			const problems = toProblems(
				{
					level: 'error',
					message: 'mismatched types',
					code: { code: 'E0308' },
					spans: [span('apps/app/src/main.rs', 4, 18), { ...span('apps/app/src/main.rs', 4, 9), is_primary: false }],
					children: [{ level: 'help', message: 'try using a conversion method', spans: [] }],
				},
				ROOT,
			);
			assert.deepStrictEqual(problems.map(where), ['apps/app/src/main.rs:3:17 error']);
			assert.strictEqual(problems[0].message, 'mismatched types\nhelp: try using a conversion method');
			assert.strictEqual(problems[0].code, 'E0308');
		});

		test('an error inside a macro points where the macro is called', () => {
			const inMacro = span('/home/u/.rustup/toolchains/stable/lib/rustlib/src/rust/library/core/src/macros/mod.rs', 100, 5, {
				expansion: { span: span('src/main.rs', 7, 5) },
			});
			assert.deepStrictEqual(toProblems({ level: 'warning', message: 'unused', spans: [inMacro] }, ROOT).map(where), ['src/main.rs:6:4 warning']);
		});

		test('skips summaries and repeats', () => {
			const summary = { level: 'error', message: 'aborting due to 1 previous error', spans: [] };
			const warning = { level: 'warning', message: 'unused variable: `x`', code: { code: 'unused_variables' }, spans: [span('src/lib.rs', 2, 9)] };
			assert.deepStrictEqual(collectProblems([summary, warning, warning], ROOT).map(where), ['src/lib.rs:1:8 warning']);
			assert.deepStrictEqual(toProblems({ level: 'failure-note', message: 'x', spans: [span('a.rs', 1, 1)] }, ROOT), []);
		});
	});

	suite('program environment', () => {
		const pkg = { name: 'app', version: '1.2.3-beta.1', manifestPath: '/w/app/Cargo.toml', dir: '/w/app' };

		test('sets what cargo run sets and puts the build folders first in the library path', () => {
			const env = appEnvironment({
				base: { LD_LIBRARY_PATH: '/usr/local/lib', HOME: '/home/u', UNSET: undefined },
				platform: 'linux',
				cargo: '/home/u/.cargo/bin/cargo',
				pkg,
				libraryDirs: ['/w/target/debug/deps', '/w/target/debug', '/toolchain/lib'],
				home: '/home/u',
			});
			assert.strictEqual(env.LD_LIBRARY_PATH, '/w/target/debug/deps:/w/target/debug:/toolchain/lib:/usr/local/lib');
			assert.strictEqual(env.CARGO_MANIFEST_DIR, '/w/app');
			assert.strictEqual(env.CARGO_PKG_VERSION, '1.2.3-beta.1');
			assert.strictEqual(env.CARGO_PKG_VERSION_MINOR, '2');
			assert.strictEqual(env.CARGO_PKG_VERSION_PRE, 'beta.1');
			assert.strictEqual(env.RUSTUP_AUTO_INSTALL, '0');
			assert.strictEqual(env.HOME, '/home/u');
			assert.ok(!('UNSET' in env));
		});

		test('uses Windows\' own Path variable and macOS\'s defaults', () => {
			const windows = appEnvironment({ base: { Path: 'C:\\Windows' }, platform: 'win32', cargo: 'cargo', pkg, libraryDirs: ['C:\\w\\target\\debug'], home: 'C:\\u' });
			assert.strictEqual(windows.Path, 'C:\\w\\target\\debug;C:\\Windows');
			assert.ok(!('PATH' in windows));

			const mac = appEnvironment({ base: {}, platform: 'darwin', cargo: 'cargo', pkg, libraryDirs: ['/w/target/debug'], home: '/Users/u' });
			assert.strictEqual(mac.DYLD_FALLBACK_LIBRARY_PATH, '/w/target/debug:/Users/u/lib:/usr/local/lib:/usr/lib');
		});
	});

	suite('restart on save', () => {
		test('rebuilds for Rust and Cargo files of the workspace only', () => {
			const scope = { root: ROOT, targetDir: path.join(ROOT, 'target') };
			assert.ok(triggersRestart(path.join(ROOT, 'crates/ui/src/lib.rs'), scope));
			assert.ok(triggersRestart(path.join(ROOT, 'Cargo.toml'), scope));
			assert.ok(triggersRestart(path.join(ROOT, 'Cargo.lock'), scope));
			assert.ok(!triggersRestart(path.join(ROOT, 'README.md'), scope));
			assert.ok(!triggersRestart(path.join(ROOT, 'target/debug/build/x/out/gen.rs'), scope));
			assert.ok(!triggersRestart(path.resolve('/elsewhere/main.rs'), scope));
		});
	});

	suite('typing into the program', () => {
		test('echoes, handles Backspace and sends whole lines', () => {
			const input = new LineInput();
			assert.deepStrictEqual(input.feed('helo'), { echo: 'helo', lines: [], end: false });
			assert.deepStrictEqual(input.feed('\x7f\x7fllo'), { echo: '\b \b\b \bllo', lines: [], end: false });
			assert.deepStrictEqual(input.feed('\r'), { echo: '\r\n', lines: ['hello\n'], end: false });
		});

		test('ignores arrow keys, splits pasted lines and closes input with Ctrl+D', () => {
			const input = new LineInput();
			assert.deepStrictEqual(input.feed('a\x1b[Ab\x1bOD\r\nc\r'), { echo: 'ab\r\nc\r\n', lines: ['ab\n', 'c\n'], end: false });
			assert.strictEqual(input.feed('x\x04').end, false);
			input.reset();
			assert.strictEqual(input.feed('\x04').end, true);
		});
	});

	suite('runner (builds with the real cargo)', function () {
		this.timeout(120_000);

		let cargo: string | undefined;
		let project: string;
		let runner: CargoRunner | undefined;
		const view = new RecordingView();
		const problems: { last: Problem[] } = { last: [] };

		suiteSetup(async function () {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-cargo-run-'));
			cargo = await findTool('cargo', project);
			if (!cargo) {
				this.skip();
			}
			fs.mkdirSync(path.join(project, 'src'));
			fs.writeFileSync(path.join(project, 'Cargo.toml'), '[package]\nname = "cargo-run-demo"\nversion = "0.1.0"\nedition = "2021"\n');
			writeMain(project, 1);
		});

		suiteTeardown(async () => {
			await runner?.stop();
			fs.rmSync(project, { recursive: true, force: true });
		});

		test('runs, keeps the old program when the build fails, then swaps in the fixed one', async () => {
			assert.ok(cargo);
			const workspace = await readWorkspace(cargo, project);
			const choice = chooseProgram(workspace, { file: path.join(project, 'src/main.rs') });
			assert.ok(choice.kind === 'selected');
			runner = new CargoRunner(view, { set: (list) => (problems.last = list), clear: () => (problems.last = []) }, { buildArgs: () => [], programArgs: () => [] });
			await runner.start({ cargo, workspace, selection: choice.selection, cwd: workspace.root, toolchainLibDirs: [] });

			const firstPid = await waitForPid(view, 1);
			assert.strictEqual(runner.state.phase, 'running');
			assert.ok(view.events.some((event) => event.startsWith('started ')));

			// Broken code: the build fails and version 1 keeps running.
			fs.writeFileSync(path.join(project, 'src/main.rs'), 'fn main() { let x: u32 = "no"; }\n');
			await runner.restart();
			assert.strictEqual(runner.state.phase, 'stale');
			assert.ok(isAlive(firstPid), 'the old program must keep running');
			assert.ok(view.events.includes('failed old=true built=false'));
			assert.ok(problems.last.some((problem) => problem.severity === 'error' && problem.file === path.join(workspace.root, 'src', 'main.rs')));

			// Fixed code: version 2 replaces version 1.
			writeMain(project, 2);
			await runner.restart();
			const secondPid = await waitForPid(view, 2);
			assert.notStrictEqual(secondPid, firstPid);
			await waitUntil(() => !isAlive(firstPid));
			assert.strictEqual(runner.state.phase, 'running');
			assert.deepStrictEqual(problems.last, []);
			assert.ok(!view.events.some((event) => event.startsWith('exited')), 'a replaced program is not reported as exited');

			// Typing a line reaches the program, which then exits normally.
			assert.ok(runner.write('bye\n'));
			await waitUntil(() => runner?.state.phase === 'idle');
			assert.ok(view.text.includes('got bye'));
			assert.ok(view.events.includes('exited 0 null'));

			// Stop ends a running program.
			await runner.restart();
			const thirdPid = await waitForPid(view, 2, 2);
			await runner.stop();
			assert.strictEqual(runner.state.phase, 'idle');
			await waitUntil(() => !isAlive(thirdPid));
			assert.ok(view.events.includes('stopped'));
		});
	});
});

/** A program that prints its version and pid, then waits for one line of input. */
function writeMain(project: string, version: number): void {
	fs.writeFileSync(
		path.join(project, 'src/main.rs'),
		[
			'fn main() {',
			`    println!("ready {} {}", ${version}, std::process::id());`,
			'    let mut line = String::new();',
			'    std::io::stdin().read_line(&mut line).unwrap();',
			'    println!("got {}", line.trim());',
			'}',
			'',
		].join('\n'),
	);
}

/** The pid printed by the `nth` "ready <version>" line. */
async function waitForPid(view: RecordingView, version: number, nth = 1): Promise<number> {
	let pid: number | undefined;
	await waitUntil(() => {
		const matches = [...view.text.matchAll(new RegExp(`ready ${version} (\\d+)`, 'g'))];
		pid = matches.length >= nth ? Number(matches[nth - 1][1]) : undefined;
		return pid !== undefined;
	});
	return pid as number;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitUntil(condition: () => boolean, timeoutMs = 60_000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('timed out');
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
