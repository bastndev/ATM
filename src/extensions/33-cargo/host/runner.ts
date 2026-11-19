import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickExecutable } from '../core/buildOutput';
import { appEnvironment } from '../core/environment';
import { CargoWorkspace } from '../core/metadata';
import { collectProblems, Problem } from '../core/problems';
import { buildArgs, displayCommand, Selection } from '../core/programs';
import { CargoBuild } from './build';
import { spawnTree, stopTree, stopTreeNow } from './processTree';

/**
 * The heart of Cargo Run: owns the one program that runs and swaps it for a
 * new build.
 *
 *   Run / Restart → cargo build (a build already going is cancelled first)
 *     ├─ fails → the program that runs keeps running; errors are shown
 *     └─ works → the old program is stopped, then the new one starts
 *
 * Building first, then starting the executable directly, is what lets the
 * old window stay open when the new code doesn't compile. `cargo run`
 * would have to close it before knowing.
 *
 * This file uses no VS Code API: the terminal, the Problems panel and the
 * settings come in through small interfaces, so tests can drive it.
 */

/** Everything needed to build and start one program. */
export interface RunSession {
	cargo: string;
	workspace: CargoWorkspace;
	selection: Selection;
	/** Where cargo runs and where the program starts: the workspace folder, like typing `cargo run` there. */
	cwd: string;
	/** The toolchain's library folder, for programs that link Rust's standard library dynamically. */
	toolchainLibDirs: string[];
}

/** Where the runner's output goes: the Cargo Run terminal. */
export interface RunnerView {
	buildStarted(command: string): void;
	output(text: string): void;
	/** The user cancelled the build; a program that was running keeps running. */
	buildCancelled(programRunning: boolean): void;
	/** No new program: the build failed, or it worked but produced no executable. */
	buildFailed(oldProgramRunning: boolean, built: boolean): void;
	programStarted(executable: string): void;
	programExited(code: number | null, signal: NodeJS.Signals | null): void;
	programFailedToStart(message: string): void;
	stopped(): void;
	/** Terminal width, for cargo's progress bar. */
	readonly columns: number | undefined;
}

export interface ProblemSink {
	set(problems: Problem[]): void;
	clear(): void;
}

export interface RunnerSettings {
	/** Extra arguments for `cargo build`, such as --release. */
	buildArgs(): string[];
	/** Arguments for the program, like the ones after `--` in `cargo run -- …`. */
	programArgs(): string[];
}

export type RunnerPhase =
	/** Nothing to show. */
	| 'idle'
	| 'building'
	| 'running'
	/** The last build failed; the program from an earlier build is still running. */
	| 'stale'
	/** The last build failed and no program runs. */
	| 'failed'
	/** The program ended with an error code or was killed. */
	| 'crashed';

export interface RunnerState {
	phase: RunnerPhase;
	/** The program's name, while there is a session. */
	label: string | undefined;
	/** A program is running (also while the next build is going). */
	programRunning: boolean;
	exitCode?: number | null;
	signal?: NodeJS.Signals | null;
}

interface ProgramExit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export class CargoRunner {
	private sessionValue: RunSession | undefined;
	private build: CargoBuild | undefined;
	private program: ChildProcess | undefined;
	/** The program being replaced: its exit is expected, not a crash. */
	private retiring: ChildProcess | undefined;
	private buildFailed = false;
	private lastExit: ProgramExit | undefined;
	/** Bumped by every Run, Restart and Stop; an older operation that sees a newer number gives up. */
	private generation = 0;
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly view: RunnerView,
		private readonly problems: ProblemSink,
		private readonly settings: RunnerSettings,
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	get session(): RunSession | undefined {
		return this.sessionValue;
	}

	/** Building, or a program is running: Stop has something to stop. */
	get active(): boolean {
		return this.build !== undefined || this.program !== undefined;
	}

	/** Whether saving a file should rebuild: from Run until Stop, or until the program closes normally. */
	get watching(): boolean {
		return this.active || this.buildFailed || (this.lastExit !== undefined && !exitedCleanly(this.lastExit));
	}

	get state(): RunnerState {
		const label = this.sessionValue?.selection.program.name;
		const programRunning = this.program !== undefined;
		const exit = this.lastExit;
		let phase: RunnerPhase = 'idle';
		if (this.build) {
			phase = 'building';
		} else if (programRunning) {
			phase = this.buildFailed ? 'stale' : 'running';
		} else if (this.buildFailed) {
			phase = 'failed';
		} else if (exit && !exitedCleanly(exit)) {
			phase = 'crashed';
		}
		return { phase, label: phase === 'idle' ? undefined : label, programRunning, exitCode: exit?.code, signal: exit?.signal };
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	/** Builds the session's program and starts it, replacing whatever runs now once the build works. */
	start(session: RunSession): Promise<void> {
		this.sessionValue = session;
		return this.rebuild();
	}

	/** Builds the current program again and swaps it in if the build works. */
	async restart(): Promise<void> {
		if (this.sessionValue) {
			await this.rebuild();
		}
	}

	/** Cancels only the build: a program that is running keeps running, as if Restart was never pressed. */
	async cancelBuild(): Promise<void> {
		const build = this.build;
		if (!build) {
			return;
		}
		this.generation++;
		this.build = undefined;
		this.notify();
		await build.cancel();
		this.view.buildCancelled(this.program !== undefined);
	}

	/** Cancels the build and stops the program; also clears a failed or crashed state. */
	async stop(): Promise<void> {
		this.generation++;
		const { build, program } = this;
		this.build = undefined;
		this.program = undefined;
		this.buildFailed = false;
		this.lastExit = undefined;
		this.problems.clear();
		this.notify();
		if (build || program) {
			await Promise.all([build?.cancel(), program && stopTree(program)]);
			this.view.stopped();
		}
	}

	/** Sends a line typed in the terminal to the program. */
	write(text: string): boolean {
		const stdin = this.program?.stdin;
		if (!stdin || stdin.destroyed) {
			return false;
		}
		stdin.write(text);
		return true;
	}

	/** Ctrl+D: the program reads end of input. */
	endInput(): void {
		this.program?.stdin?.end();
	}

	get acceptsInput(): boolean {
		return this.program !== undefined;
	}

	/** Stops everything without waiting, for when the editor closes. */
	dispose(): void {
		this.generation++;
		this.build?.cancel().catch(() => undefined);
		if (this.program) {
			stopTreeNow(this.program);
		}
		this.build = undefined;
		this.program = undefined;
		this.listeners.clear();
	}

	private async rebuild(): Promise<void> {
		const session = this.sessionValue;
		if (!session) {
			return;
		}
		const generation = ++this.generation;
		const previous = this.build;
		this.build = undefined;
		await previous?.cancel();
		if (generation !== this.generation) {
			return;
		}

		const args = buildArgs(session.selection, this.settings.buildArgs());
		this.lastExit = undefined;
		this.view.buildStarted(displayCommand(args));
		const build = new CargoBuild({ cargo: session.cargo, cwd: session.cwd, args, columns: this.view.columns }, (text) => this.view.output(text));
		this.build = build;
		this.notify();

		const result = await build.done;
		if (generation !== this.generation) {
			return;
		}
		this.build = undefined;
		this.problems.set(collectProblems(result.messages, session.workspace.root));

		const executable = result.success ? pickExecutable(result.artifacts, session.selection.program) : undefined;
		if (!executable) {
			this.buildFailed = true;
			this.notify();
			this.view.buildFailed(this.program !== undefined, result.success);
			return;
		}
		this.buildFailed = false;
		await this.retire();
		if (generation !== this.generation) {
			return;
		}
		await this.launch(session, executable, generation);
	}

	/** Stops the running program because a new build replaces it. */
	private async retire(): Promise<void> {
		const old = this.program;
		if (!old) {
			return;
		}
		this.retiring = old;
		await stopTree(old);
		this.retiring = undefined;
		if (this.program === old) {
			this.program = undefined;
		}
	}

	private async launch(session: RunSession, executable: string, generation: number): Promise<void> {
		const { pkg } = session.selection;
		const outputDir = path.dirname(executable);
		const env = appEnvironment({
			base: process.env,
			platform: this.platform,
			cargo: session.cargo,
			pkg,
			// What cargo run adds: dynamic libraries built next to the program, then the toolchain's.
			libraryDirs: [path.join(outputDir, 'deps'), outputDir, ...session.toolchainLibDirs],
			home: os.homedir(),
		});
		const command = this.platform === 'win32' ? await copyForWindows(executable) : executable;
		if (generation !== this.generation) {
			return;
		}

		const child = spawnTree(command, this.settings.programArgs(), { cwd: session.cwd, env });
		this.program = child;
		this.view.programStarted(path.relative(session.cwd, executable) || executable);
		child.stdout?.on('data', (text: string) => this.view.output(text));
		child.stderr?.on('data', (text: string) => this.view.output(text));
		child.on('error', (error) => {
			if (this.program !== child) {
				return;
			}
			this.program = undefined;
			this.lastExit = { code: null, signal: null };
			this.view.programFailedToStart(error.message);
			this.notify();
		});
		child.on('exit', (code, signal) => {
			if (this.program !== child || this.retiring === child) {
				return;
			}
			this.program = undefined;
			this.lastExit = { code, signal };
			this.view.programExited(code, signal);
			this.notify();
		});
		this.notify();
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}

function exitedCleanly(exit: ProgramExit): boolean {
	return exit.code === 0 && exit.signal === null;
}

const COPY_ATTEMPTS = 10;
const COPY_RETRY_MS = 100;

/**
 * Windows locks a running .exe, so the next `cargo build` couldn't replace
 * it ("Access is denied"). The program runs from a copy in the same folder
 * instead, which keeps DLLs and assets next to it findable.
 */
async function copyForWindows(executable: string): Promise<string> {
	const parsed = path.parse(executable);
	const copy = path.join(parsed.dir, `${parsed.name}.atm-run${parsed.ext}`);
	for (let attempt = 1; ; attempt++) {
		try {
			await fs.promises.copyFile(executable, copy);
			return copy;
		} catch {
			// The old copy can stay locked for a moment after its process exits.
			if (attempt >= COPY_ATTEMPTS) {
				return executable;
			}
			await new Promise((resolve) => setTimeout(resolve, COPY_RETRY_MS));
		}
	}
}
