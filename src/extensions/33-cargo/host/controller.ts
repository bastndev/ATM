import * as vscode from 'vscode';
import { samePath } from '../core/paths';
import { ProblemSink } from '../core/problems';
import { affectsBuild } from '../core/saveFilter';
import { CargoStatusBar } from '../ui/statusBar';
import { CargoTerminal } from '../ui/terminal';
import { BuildActivity } from './checker';
import { activeFile, CargoProjects } from './projects';
import { CargoRunner } from './runner';
import { SessionRequest, SessionResolver } from './session';

/**
 * Connects Cargo Run to VS Code: commands, settings, saves, workspace trust
 * and the two context keys that decide where the ▶ button and the
 * Alt+G / Ctrl+G keys apply.
 *
 * - `atm.cargo.project`: the active file is inside a Cargo project (with no
 *   file open: a program is running). The keys and the ▶ follow it, so in a
 *   Tauri project Alt+G runs Cargo from a .rs file and Run Dev from a .ts one.
 * - `atm.cargo.running`: a build or a program is running; the ▶ becomes ■.
 * - `atm.cargo.building`: a build is going; the ■ becomes the spinning
 *   squares, and a click cancels only the build.
 */

const SECTION = 'atm.cargo';
const CONTEXT_PROJECT = 'atm.cargo.project';
const CONTEXT_RUNNING = 'atm.cargo.running';
const CONTEXT_BUILDING = 'atm.cargo.building';
/** Saving several files at once (Save All) restarts once. */
const SAVE_DEBOUNCE_MS = 300;

export class CargoController implements BuildActivity, vscode.Disposable {
	private readonly sessions: SessionResolver;
	private readonly terminal: CargoTerminal;
	private readonly statusBar = new CargoStatusBar();
	private readonly runner: CargoRunner;
	private readonly disposables: vscode.Disposable[];
	private readonly contexts = new Map<string, boolean>();
	private resolving = false;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	/** Bumped per project check, so a slow answer for an old editor is dropped. */
	private projectCheck = 0;
	/** Saving every file right before a build: those saves are this build's, not the save check's. */
	private savingForBuild = false;

	/** `projects` and `problems` are shared with the save check; activateCargo owns and disposes them. */
	constructor(
		memento: vscode.Memento,
		private readonly projects: CargoProjects,
		problems: ProblemSink,
	) {
		this.sessions = new SessionResolver(memento, this.projects);
		this.terminal = new CargoTerminal({
			acceptsInput: () => this.runner.acceptsInput,
			input: (line) => this.runner.write(line),
			endInput: () => this.runner.endInput(),
			interrupt: () => void this.stop(),
			closed: () => void this.stop(),
		});
		this.runner = new CargoRunner(this.terminal, problems, {
			buildArgs: () => stringList(this.config().get('buildArgs')),
			programArgs: () => stringList(this.config().get('programArgs')),
		});
		this.disposables = [
			this.terminal,
			this.statusBar,
			this.runner.onDidChange(() => this.render()),
			this.projects.onDidChange(() => void this.updateProjectContext()),
			vscode.window.onDidChangeActiveTextEditor(() => void this.updateProjectContext()),
			vscode.workspace.onDidSaveTextDocument((document) => this.onSave(document)),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(SECTION)) {
					this.onConfigChange();
				}
			}),
		];
		this.render();
	}

	/**
	 * Run, from the ▶ button, the palette or a ▶ Run button above main().
	 * Returns false when Cargo Run is turned off, so the ▶ Run button can
	 * fall back to a plain cargo task.
	 */
	run(request: SessionRequest): boolean {
		if (!this.enabled()) {
			return false;
		}
		void this.start(request);
		return true;
	}

	/** Alt+G and the status bar: stop when something runs, run otherwise. */
	toggle(): void {
		if (this.runner.active) {
			void this.stop();
		} else {
			this.run({ file: activeFile() });
		}
	}

	/** Ctrl+G: rebuild and swap in the new program; runs when nothing was running. */
	restart(): void {
		if (!this.enabled()) {
			return;
		}
		if (this.runner.session && this.runner.watching) {
			void this.saveThen(() => this.runner.restart());
		} else {
			this.run({ file: activeFile() });
		}
	}

	async stop(): Promise<void> {
		clearTimeout(this.saveTimer);
		await this.runner.stop();
	}

	/** The spinner in the editor title: stop building, keep the program that runs. */
	async cancelBuild(): Promise<void> {
		clearTimeout(this.saveTimer);
		await this.runner.cancelBuild();
	}

	showOutput(): void {
		this.terminal.show(false);
	}

	/** Cargo Run is building in this workspace. */
	isBuilding(root: string): boolean {
		const session = this.runner.session;
		return session !== undefined && this.runner.state.phase === 'building' && samePath(session.workspace.root, root);
	}

	/** Fires when a build starts or ends (and on every other change of the runner). */
	onDidChange(listener: () => void): vscode.Disposable {
		return this.runner.onDidChange(listener);
	}

	/**
	 * Cargo Run builds this save itself: it is one of the saves made right
	 * before a build, or restart-on-save rebuilds for it. Checking it too
	 * would only repeat that build. Asked while the save event is handled.
	 */
	coversSave(file: string): boolean {
		return this.savingForBuild || this.restartsOnSave(file);
	}

	private async start(request: SessionRequest): Promise<void> {
		if (!vscode.workspace.isTrusted) {
			const manage = vscode.l10n.t('Manage Workspace Trust');
			const answer = await vscode.window.showWarningMessage(
				vscode.l10n.t('Cargo Run builds and runs this project, which runs its code (build.rs, macros). Trust the folder first.'),
				manage,
			);
			if (answer === manage) {
				await vscode.commands.executeCommand('workbench.trust.manage');
			}
			return;
		}
		if (this.resolving) {
			return;
		}
		this.resolving = true;
		try {
			const session = await this.sessions.resolve(request);
			if (session) {
				this.terminal.show(true);
				await this.saveThen(() => this.runner.start(session));
			}
		} catch (error) {
			this.reportError(error);
		} finally {
			this.resolving = false;
		}
	}

	/** Saves open files first, like VS Code tasks do (task.saveBeforeRun), so the build sees the latest code. */
	private async saveThen(action: () => Promise<void>): Promise<void> {
		if (vscode.workspace.getConfiguration('task').get<string>('saveBeforeRun', 'always') === 'always') {
			// VS Code reports each save before saveAll resolves, so the flag covers all of them.
			this.savingForBuild = true;
			try {
				await vscode.workspace.saveAll(false);
			} finally {
				this.savingForBuild = false;
			}
		}
		// Those saves would also trigger restart-on-save; this build covers them.
		clearTimeout(this.saveTimer);
		await action();
	}

	private onSave(document: vscode.TextDocument): void {
		if (document.uri.scheme !== 'file' || !this.restartsOnSave(document.uri.fsPath)) {
			return;
		}
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.runner.restart(), SAVE_DEBOUNCE_MS);
	}

	/** restart-on-save is on and this file belongs to the program that runs (or failed to build). */
	private restartsOnSave(file: string): boolean {
		const session = this.runner.session;
		return (
			session !== undefined &&
			this.runner.watching &&
			this.config().get<boolean>('restartOnSave', false) &&
			affectsBuild(file, { root: session.workspace.root, targetDir: session.workspace.targetDir })
		);
	}

	private onConfigChange(): void {
		if (!this.enabled()) {
			void this.stop();
		}
		this.render();
	}

	private render(): void {
		this.statusBar.render(this.runner.state);
		this.setContext(CONTEXT_RUNNING, this.runner.active);
		this.setContext(CONTEXT_BUILDING, this.runner.state.phase === 'building');
		void this.updateProjectContext();
	}

	private async updateProjectContext(): Promise<void> {
		const check = ++this.projectCheck;
		const file = activeFile();
		let inProject = false;
		if (this.enabled()) {
			inProject = file ? (await this.projects.manifestDir(file)) !== undefined : this.runner.active;
		}
		if (check === this.projectCheck) {
			this.setContext(CONTEXT_PROJECT, inProject);
		}
	}

	private setContext(key: string, value: boolean): void {
		if (this.contexts.get(key) !== value) {
			this.contexts.set(key, value);
			void vscode.commands.executeCommand('setContext', key, value);
		}
	}

	/** cargo's message (broken Cargo.toml, missing toolchain…) in full in the terminal, its first line as a notification. */
	private reportError(error: unknown): void {
		const text = error instanceof Error ? error.message : String(error);
		this.terminal.error(text);
		void vscode.window.showErrorMessage(vscode.l10n.t('Cargo Run: {0}', text.split('\n')[0]));
	}

	private enabled(): boolean {
		return this.config().get<boolean>('enabled', true);
	}

	private config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration(SECTION);
	}

	dispose(): void {
		clearTimeout(this.saveTimer);
		this.runner.dispose();
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
