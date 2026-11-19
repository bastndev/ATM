import { ChildProcess } from 'child_process';
import { NO_AUTO_INSTALL } from '../../32-rust/core/rustup';
import { Artifact, LineSplitter, parseBuildLine } from '../core/buildOutput';
import { spawnTree, stopTree } from './processTree';

/**
 * One `cargo build` run. Shows cargo's output as it comes, keeps the
 * compiler messages for the Problems panel and reports the executable it
 * produced. It never starts the program; the runner decides that.
 */

export interface BuildSpec {
	cargo: string;
	cwd: string;
	args: string[];
	/** Terminal width, for cargo's progress bar. */
	columns: number | undefined;
}

export interface BuildResult {
	success: boolean;
	cancelled: boolean;
	artifacts: Artifact[];
	/** rustc's JSON diagnostics. */
	messages: unknown[];
}

/** After cargo exits, how long to wait for the rest of its output. */
const OUTPUT_FLUSH_MS = 1000;
/** Moves to the start of the line and clears it, so text doesn't land on cargo's progress bar. */
const CLEAR_LINE = '\r\x1b[K';

export class CargoBuild {
	readonly done: Promise<BuildResult>;
	private readonly child: ChildProcess;
	private cancelled = false;

	constructor(spec: BuildSpec, output: (text: string) => void) {
		this.child = spawnTree(spec.cargo, spec.args, { cwd: spec.cwd, env: buildEnv(spec.columns) });
		this.done = collect(this.child, output, () => this.cancelled);
	}

	/** Stops the build and waits until cargo has let go of the target folder. */
	async cancel(): Promise<void> {
		this.cancelled = true;
		await stopTree(this.child);
		await this.done;
	}
}

function buildEnv(columns: number | undefined): NodeJS.ProcessEnv {
	return {
		...process.env,
		...NO_AUTO_INSTALL,
		CARGO_TERM_COLOR: 'always',
		// stderr is a pipe, so cargo would hide its progress bar; the terminal can draw it.
		CARGO_TERM_PROGRESS_WHEN: 'always',
		CARGO_TERM_PROGRESS_WIDTH: String(Math.max(columns ?? 80, 40)),
	};
}

function collect(child: ChildProcess, output: (text: string) => void, isCancelled: () => boolean): Promise<BuildResult> {
	const lines = new LineSplitter();
	const artifacts: Artifact[] = [];
	const messages: unknown[] = [];
	let finished: boolean | undefined;

	const handleLine = (line: string) => {
		const event = parseBuildLine(line);
		switch (event?.type) {
			case 'text':
				output(`${CLEAR_LINE}${event.text}\n`);
				break;
			case 'message':
				messages.push(event.message);
				if (event.rendered) {
					output(CLEAR_LINE + (event.rendered.endsWith('\n') ? event.rendered : event.rendered + '\n'));
				}
				break;
			case 'artifact':
				artifacts.push(event.artifact);
				break;
			case 'finished':
				finished = event.success;
				break;
		}
	};
	child.stdout?.on('data', (chunk: string) => lines.push(chunk).forEach(handleLine));
	child.stderr?.on('data', (chunk: string) => output(chunk));

	return new Promise((resolve) => {
		let settled = false;
		let flushTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (exitCode: number | null) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(flushTimer);
			lines.end().forEach(handleLine);
			const cancelled = isCancelled();
			resolve({ success: !cancelled && exitCode === 0 && finished !== false, cancelled, artifacts, messages });
		};
		child.on('error', (error) => {
			output(`${CLEAR_LINE}${error.message}\n`);
			finish(null);
		});
		// 'close' waits for all output. A helper that keeps stdout open (a build-script daemon)
		// would delay it forever, so 'exit' plus a short wait also ends the build.
		child.on('close', (code) => finish(code));
		child.on('exit', (code) => {
			flushTimer = setTimeout(() => finish(code), OUTPUT_FLUSH_MS);
		});
	});
}
