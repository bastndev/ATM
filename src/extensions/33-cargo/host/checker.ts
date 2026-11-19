import { BuildResult } from './build';
import { CargoFailure, checkArgs } from '../core/check';
import { collectProblems, ProblemSink } from '../core/problems';

/**
 * The save check: `cargo check` in the background, so a mistake is
 * underlined right after Ctrl+S, without pressing Run. At most one check
 * runs per Cargo workspace:
 *
 *   save ─(200 ms, so Save All starts one check)→ cargo check --workspace
 *     ├─ saved again while it runs
 *     │    ├─ warm (a check already finished here this session) and running
 *     │    │  for less than 10 s: restart it, little work is lost
 *     │    └─ otherwise (the first check, maybe checking every dependency, or
 *     │       one that ran long, e.g. after `cargo clean`): let it finish,
 *     │       so frequent saves can't keep restarting it forever, then check again
 *     ├─ Cargo Run starts building here: cancel; its build reports the same
 *     │  errors, and saves made during the build are checked after it
 *     └─ cancel(): a cargo command started in a terminal, so it doesn't
 *        wait for this check's lock on the target folder
 *
 * `cargo check` skips code generation and linking, the slow part of a
 * build, and shares target/ with the user's builds: dependencies are
 * checked once, then each check redoes only the crates that changed.
 *
 * No VS Code API: the cargo process, Cargo Run and the problems come in
 * through small interfaces, so tests drive it with fake checks.
 */

export interface CheckTarget {
	/** The workspace folder (cargo metadata's workspace_root): cargo runs there and the problems belong to it. */
	root: string;
	cargo: string;
}

/** One running `cargo check`. */
export interface CheckRun {
	readonly done: Promise<BuildResult>;
	/** Stops cargo and resolves once it has let go of the target folder. */
	cancel(): Promise<void>;
}

export type StartCheck = (target: CheckTarget, args: string[], output: (text: string) => void) => CheckRun;

/** What Cargo Run is doing, so a check never races its build for the target folder. */
export interface BuildActivity {
	isBuilding(root: string): boolean;
	onDidChange(listener: () => void): { dispose(): void };
}

export interface CheckerOptions {
	/** Extra arguments for cargo check (atm.cargo.checkArgs). */
	args(): string[];
	/** cargo stopped before checking any code: a broken Cargo.toml, a missing toolchain, a failing build script… */
	failed(root: string, message: string): void;
	/** How long to wait after a save; tests pass 0. */
	delayMs?: number;
	/** The clock, for tests. */
	now?: () => number;
}

const SAVE_DELAY_MS = 200;
/** A check that ran this long is let finish rather than restarted. */
const RESTART_WINDOW_MS = 10_000;

interface WorkspaceCheck {
	target: CheckTarget;
	run: CheckRun | undefined;
	/** When the running check started. */
	startedAt: number;
	/** The cancelled check, until it has let go of the target folder. */
	stopping: Promise<void> | undefined;
	timer: ReturnType<typeof setTimeout> | undefined;
	/** Saved while a check that is let finish ran, or while Cargo Run built: check again afterwards. */
	again: boolean;
	/** A check finished here, so dependencies are checked and restarting costs little. */
	warm: boolean;
	/** Cargo Run was building here at the last look. */
	building: boolean;
	/** Bumped by every start and cancel; a check holding an older number was replaced. */
	generation: number;
}

export class CargoChecker {
	private readonly workspaces = new Map<string, WorkspaceCheck>();
	private readonly listeners = new Set<() => void>();
	private readonly activitySubscription: { dispose(): void };
	private readonly delayMs: number;
	private readonly now: () => number;

	constructor(
		private readonly startCheck: StartCheck,
		private readonly problems: ProblemSink,
		private readonly activity: BuildActivity,
		private readonly options: CheckerOptions,
	) {
		this.delayMs = options.delayMs ?? SAVE_DELAY_MS;
		this.now = options.now ?? Date.now;
		this.activitySubscription = activity.onDidChange(() => this.onActivity());
	}

	/** A check is running in some workspace. */
	get busy(): boolean {
		return [...this.workspaces.values()].some((check) => check.run !== undefined);
	}

	onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	/** Checks the workspace soon. Saves that come close together lead to one check. */
	request(target: CheckTarget): void {
		const check = this.workspace(target);
		clearTimeout(check.timer);
		check.timer = setTimeout(() => {
			check.timer = undefined;
			this.kick(check);
		}, this.delayMs);
	}

	/** Drops this workspace's check: the running one, and any that was about to start. */
	cancel(root: string): void {
		const check = this.workspaces.get(root);
		if (check) {
			this.drop(check);
		}
	}

	cancelAll(): void {
		this.workspaces.forEach((check) => this.drop(check));
	}

	dispose(): void {
		this.cancelAll();
		this.activitySubscription.dispose();
		this.listeners.clear();
	}

	private workspace(target: CheckTarget): WorkspaceCheck {
		let check = this.workspaces.get(target.root);
		if (!check) {
			check = {
				target,
				run: undefined,
				startedAt: 0,
				stopping: undefined,
				timer: undefined,
				again: false,
				warm: false,
				building: this.activity.isBuilding(target.root),
				generation: 0,
			};
			this.workspaces.set(target.root, check);
		}
		// The cargo to use can change (rust-toolchain.toml); the newest answer wins.
		check.target = target;
		return check;
	}

	private kick(check: WorkspaceCheck): void {
		if (this.activity.isBuilding(check.target.root)) {
			check.again = true;
			return;
		}
		if (check.run && (!check.warm || this.now() - check.startedAt >= RESTART_WINDOW_MS)) {
			check.again = true;
			return;
		}
		void this.run(check);
	}

	private drop(check: WorkspaceCheck): void {
		clearTimeout(check.timer);
		check.timer = undefined;
		check.again = false;
		this.stop(check);
	}

	/** Cancels the running check, if any, and makes a check that is still starting give up. */
	private stop(check: WorkspaceCheck): void {
		check.generation++;
		const run = check.run;
		if (!run) {
			return;
		}
		check.run = undefined;
		check.stopping = run.cancel().catch(() => undefined);
		this.notify();
	}

	private async run(check: WorkspaceCheck): Promise<void> {
		this.stop(check);
		const generation = check.generation;
		// Two cargo processes on one target/ would only wait for each other.
		await check.stopping;
		if (generation !== check.generation) {
			return;
		}
		const { root } = check.target;
		const failure = new CargoFailure();
		const run = this.startCheck(check.target, checkArgs(this.options.args()), (text) => failure.push(text));
		check.run = run;
		check.startedAt = this.now();
		check.again = false;
		this.notify();

		const result = await run.done;
		if (generation !== check.generation) {
			return;
		}
		check.run = undefined;
		const problems = collectProblems(result.messages, root);
		if (result.success || problems.some((problem) => problem.severity === 'error')) {
			check.warm = true;
			this.problems.set(root, problems);
		} else if (!result.cancelled) {
			// Nothing was checked, so the problems shown so far are the best there is: keep them.
			this.options.failed(root, failure.message() ?? 'cargo check failed');
		}
		this.notify();
		if (check.again) {
			this.kick(check);
		}
	}

	/** Cargo Run started or finished a build somewhere. */
	private onActivity(): void {
		for (const check of this.workspaces.values()) {
			const building = this.activity.isBuilding(check.target.root);
			const wasBuilding = check.building;
			check.building = building;
			if (building && !wasBuilding) {
				// Cargo Run saved every file before building, so its build covers the saves so far.
				this.drop(check);
			} else if (!building && wasBuilding && check.again) {
				this.kick(check);
			}
		}
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
