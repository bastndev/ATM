import * as path from 'path';
import * as vscode from 'vscode';
import { OFFICIAL_RUST_EXTENSION } from '../../32-rust/core/officialExtension';
import { isCargoCommand, manifestPathIn } from '../core/check';
import { ProblemSink } from '../core/problems';
import { affectsBuild, isCargoSource } from '../core/saveFilter';
import { CargoBuild } from './build';
import { CargoChecker, CheckTarget, StartCheck } from './checker';
import { CargoController } from './controller';
import { CargoProjects } from './projects';
import { CargoWorkspaces } from './workspaces';

/**
 * Connects the save check to VS Code. It checks after:
 *
 * - **a save** of a .rs file, Cargo.toml or Cargo.lock in a Cargo project
 *   (Ctrl+S, Save All, auto save), unless Cargo Run is building that save
 *   itself;
 * - **a cargo command typed in a terminal** (`cargo run`, `cargo build`…),
 *   once it ends. Its errors are then underlined too, so there is no need to
 *   read them in the terminal. ATM doesn't read the terminal's text: shell
 *   integration says which command ran and where, and the check asks the
 *   compiler again, in JSON, for exact positions. While such a command
 *   starts, a running check is cancelled so the command doesn't wait for it.
 *
 * The problems go to the same place as Cargo Run's, so Error Lens shows
 * them at the end of the line. A running check shows nothing in the status
 * bar; only a check that couldn't run says why, for a few seconds. The
 * setting atm.cargo.checkOnSave turns it
 * off. It never runs in an untrusted folder (building runs the project's
 * build.rs and macros) or while the rust-analyzer extension is installed,
 * which checks on save itself.
 */

const SECTION = 'atm.cargo';
const ENABLED_KEY = 'checkOnSave';
const FAILURE_MESSAGE_MS = 10_000;

export class CheckController implements vscode.Disposable {
	private readonly workspaces = new CargoWorkspaces();
	private readonly checker: CargoChecker;
	private readonly disposables: vscode.Disposable[];
	private failureMessage: vscode.Disposable | undefined;

	constructor(
		private readonly projects: CargoProjects,
		problems: ProblemSink,
		private readonly cargoRun: CargoController,
	) {
		this.checker = new CargoChecker(startBackgroundCheck, problems, cargoRun, {
			args: () => stringList(this.config().get('checkArgs')),
			failed: (_root, message) => this.showFailure(message),
		});
		this.disposables = [
			// A new check makes an old "couldn't run" message out of date.
			this.checker.onDidChange(() => this.checker.busy && this.failureMessage?.dispose()),
			projects.onDidChange(() => this.workspaces.reset()),
			vscode.workspace.onDidSaveTextDocument((document) => this.onSave(document)),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(SECTION)) {
					this.stopIfDisabled();
				}
			}),
			vscode.extensions.onDidChange(() => this.stopIfDisabled()),
			...this.watchTerminals(),
		];
	}

	private onSave(document: vscode.TextDocument): void {
		const file = document.uri.fsPath;
		if (document.uri.scheme !== 'file' || !isCargoSource(file)) {
			return;
		}
		if (path.basename(file) === 'Cargo.toml') {
			this.workspaces.reset();
		}
		// Asked now, while the save is being handled: Cargo Run's own saves come right before its build.
		if (!this.enabled() || this.cargoRun.coversSave(file)) {
			return;
		}
		void this.checkAfterSave(file);
	}

	private async checkAfterSave(file: string): Promise<void> {
		const found = await this.locate(await this.projects.manifestDir(file));
		if (found && affectsBuild(file, found.scope)) {
			this.checker.request(found.target);
		}
	}

	/**
	 * Commands typed in VS Code's terminal, through shell integration (VS
	 * Code 1.93 and later, on by default for bash, zsh, fish and
	 * PowerShell). Older editors simply don't get this part.
	 */
	private watchTerminals(): vscode.Disposable[] {
		const window: Partial<Pick<typeof vscode.window, 'onDidStartTerminalShellExecution' | 'onDidEndTerminalShellExecution'>> = vscode.window;
		if (!window.onDidStartTerminalShellExecution || !window.onDidEndTerminalShellExecution) {
			return [];
		}
		return [
			window.onDidStartTerminalShellExecution((event) => void this.onTerminalCommand(event.terminal, event.execution, 'start')),
			window.onDidEndTerminalShellExecution((event) => void this.onTerminalCommand(event.terminal, event.execution, 'end')),
		];
	}

	private async onTerminalCommand(terminal: vscode.Terminal, execution: vscode.TerminalShellExecution, moment: 'start' | 'end'): Promise<void> {
		const commandLine = execution.commandLine.value;
		if (!this.enabled() || !isCargoCommand(commandLine)) {
			return;
		}
		const cwd = terminalFolder(terminal, execution);
		if (!cwd) {
			return;
		}
		const manifest = manifestPathIn(commandLine);
		const found = await this.locate(await this.projects.projectDir(manifest ? path.dirname(path.resolve(cwd, manifest)) : cwd));
		if (!found) {
			return;
		}
		if (moment === 'start') {
			this.checker.cancel(found.target.root);
		} else {
			this.checker.request(found.target);
		}
	}

	/** The check target for a project folder, or undefined (and a status bar message) when cargo can't read it. */
	private async locate(dir: string | undefined): Promise<{ target: CheckTarget; scope: { root: string; targetDir: string } } | undefined> {
		if (!dir) {
			return undefined;
		}
		try {
			const { cargo, workspace } = await this.workspaces.get(dir);
			return { target: { root: workspace.root, cargo }, scope: { root: workspace.root, targetDir: workspace.targetDir } };
		} catch (error) {
			this.showFailure(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	/** cargo's reason, briefly in the status bar: a check that couldn't run is worth knowing, not worth a popup on every save. */
	private showFailure(message: string): void {
		this.failureMessage?.dispose();
		const line = message.split('\n').find((text) => text.trim().length > 0) ?? message;
		this.failureMessage = vscode.window.setStatusBarMessage(`$(warning) cargo check: ${line.trim()}`, FAILURE_MESSAGE_MS);
	}

	private stopIfDisabled(): void {
		if (!this.enabled()) {
			this.checker.cancelAll();
		}
	}

	private enabled(): boolean {
		return (
			vscode.workspace.isTrusted &&
			this.config().get<boolean>(ENABLED_KEY, true) &&
			vscode.extensions.getExtension(OFFICIAL_RUST_EXTENSION) === undefined
		);
	}

	private config(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration(SECTION);
	}

	dispose(): void {
		this.checker.dispose();
		this.failureMessage?.dispose();
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

const startBackgroundCheck: StartCheck = (target, args, output) =>
	new CargoBuild({ cargo: target.cargo, cwd: target.root, args, columns: undefined, background: true }, output);

/** Where the command ran: shell integration's answer, else the terminal's own folder, else the only workspace folder. */
function terminalFolder(terminal: vscode.Terminal, execution: vscode.TerminalShellExecution): string | undefined {
	const candidates = [execution.cwd, terminal.shellIntegration?.cwd];
	const known = candidates.find((uri) => uri?.scheme === 'file');
	if (known) {
		return known.fsPath;
	}
	const options = terminal.creationOptions as vscode.TerminalOptions;
	if (typeof options.cwd === 'string') {
		return options.cwd;
	}
	if (options.cwd instanceof vscode.Uri && options.cwd.scheme === 'file') {
		return options.cwd.fsPath;
	}
	const folders = vscode.workspace.workspaceFolders ?? [];
	return folders.length === 1 && folders[0].uri.scheme === 'file' ? folders[0].uri.fsPath : undefined;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
