import * as vscode from 'vscode';
import { LineInput } from '../core/lineInput';
import { RunnerView } from '../host/runner';

/**
 * The Cargo Run terminal: build output, then the program's own output.
 * One terminal is reused for every run. Each build starts on a clean
 * screen so the errors shown are always the latest ones. Typing goes to
 * the program, and Ctrl+C stops it, like in a normal terminal. Closing the
 * terminal stops the program too.
 */

export interface TerminalHandlers {
	acceptsInput(): boolean;
	input(line: string): void;
	endInput(): void;
	/** Ctrl+C. */
	interrupt(): void;
	/** The user closed the terminal. */
	closed(): void;
}

const CTRL_C = '\x03';
/** Clears the screen and the scrollback, and moves to the top. */
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';
/** Output kept while VS Code is still opening the terminal. */
const MAX_PENDING_CHUNKS = 2000;

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const red = (text: string) => `\x1b[1;31m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[1;33m${text}\x1b[0m`;
/** Bold green, right-aligned to 12 columns: cargo's own "     Running" style. */
const cargoStatus = (word: string) => `\x1b[1m\x1b[92m${word.padStart(12)}\x1b[0m`;

export class CargoTerminal implements RunnerView, vscode.Disposable {
	private terminal: vscode.Terminal | undefined;
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	private opened = false;
	private pending: string[] = [];
	private columnsValue: number | undefined;
	private readonly lineInput = new LineInput();

	constructor(private readonly handlers: TerminalHandlers) {}

	get columns(): number | undefined {
		return this.columnsValue;
	}

	show(preserveFocus = true): void {
		this.ensure().show(preserveFocus);
	}

	// --- RunnerView ---

	buildStarted(command: string): void {
		this.write(`${CLEAR}${dim(`$ ${command}`)}\n`);
	}

	output(text: string): void {
		this.write(text);
	}

	buildFailed(oldProgramRunning: boolean, built: boolean): void {
		const message = built
			? red(vscode.l10n.t('The build worked but produced no program to start.'))
			: oldProgramRunning
				? yellow(vscode.l10n.t('The build failed, so the program from the previous build keeps running. Fix the errors, then restart (Ctrl+G).'))
				: red(vscode.l10n.t('The build failed. Fix the errors, then run again (Ctrl+G).'));
		this.write(`\n${message}\n`);
		this.show();
	}

	programStarted(executable: string): void {
		this.lineInput.reset();
		this.write(`${cargoStatus('Running')} \`${executable}\`\n`);
	}

	programExited(code: number | null, signal: NodeJS.Signals | null): void {
		const failed = code !== 0 || signal !== null;
		const text = signal
			? vscode.l10n.t('The program was stopped by {0}.', signal)
			: vscode.l10n.t('The program exited with code {0}.', String(code ?? '?'));
		this.write(`\n${failed ? red(text) : dim(text)}\n`, false);
		if (failed) {
			this.show();
		}
	}

	programFailedToStart(message: string): void {
		this.write(`\n${red(vscode.l10n.t('The program could not start: {0}', message))}\n`);
		this.show();
	}

	stopped(): void {
		this.write(`\n${dim(vscode.l10n.t('■ Stopped.'))}\n`, false);
	}

	/** An error from before the build, such as a broken Cargo.toml or a missing toolchain. */
	error(text: string): void {
		this.write(`${CLEAR}${red(text)}\n`);
		this.show();
	}

	// --- Terminal plumbing ---

	/** Writes to the terminal; with `create` false, only when the terminal is still open. */
	private write(text: string, create = true): void {
		if (!this.terminal && !create) {
			return;
		}
		this.ensure();
		const normalized = text.replace(/\r?\n/g, '\r\n');
		if (this.opened) {
			this.writeEmitter.fire(normalized);
		} else if (this.pending.length < MAX_PENDING_CHUNKS) {
			this.pending.push(normalized);
		}
	}

	private ensure(): vscode.Terminal {
		if (this.terminal) {
			return this.terminal;
		}
		const pty: vscode.Pseudoterminal = {
			onDidWrite: this.writeEmitter.event,
			open: (dimensions) => {
				this.opened = true;
				this.columnsValue = dimensions?.columns;
				this.pending.forEach((chunk) => this.writeEmitter.fire(chunk));
				this.pending = [];
			},
			close: () => this.onClosed(terminal),
			handleInput: (data) => this.handleInput(data),
			setDimensions: (dimensions) => {
				this.columnsValue = dimensions.columns;
			},
		};
		const terminal = vscode.window.createTerminal({ name: 'Cargo Run', pty, iconPath: new vscode.ThemeIcon('play'), isTransient: true });
		this.terminal = terminal;
		return terminal;
	}

	private onClosed(terminal: vscode.Terminal): void {
		if (this.terminal !== terminal) {
			return;
		}
		this.terminal = undefined;
		this.opened = false;
		this.pending = [];
		this.handlers.closed();
	}

	private handleInput(data: string): void {
		if (data.includes(CTRL_C)) {
			this.handlers.interrupt();
			return;
		}
		if (!this.handlers.acceptsInput()) {
			return;
		}
		const result = this.lineInput.feed(data);
		if (result.echo) {
			this.write(result.echo);
		}
		result.lines.forEach((line) => this.handlers.input(line));
		if (result.end) {
			this.handlers.endInput();
		}
	}

	dispose(): void {
		const terminal = this.terminal;
		this.terminal = undefined;
		terminal?.dispose();
		this.writeEmitter.dispose();
	}
}
