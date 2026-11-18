import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { ProcessSpec } from '../core/runnables';

/**
 * Runs a process in a terminal that stays open after it ends, showing the
 * exit code. Used by ▶ Run when no folder is open, because VS Code only runs
 * tasks inside a folder.
 */
export function openRunTerminal(name: string, spec: ProcessSpec): vscode.Terminal {
	const writeEmitter = new vscode.EventEmitter<string>();
	const closeEmitter = new vscode.EventEmitter<number | void>();
	let child: ChildProcess | undefined;

	const write = (text: string) => writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));

	const pty: vscode.Pseudoterminal = {
		onDidWrite: writeEmitter.event,
		onDidClose: closeEmitter.event,
		open: () => {
			write(`> ${[spec.command, ...spec.args].join(' ')}\n\n`);
			child = spawn(spec.command, spec.args, {
				cwd: spec.cwd,
				env: { ...process.env, CARGO_TERM_COLOR: 'always', ...spec.env },
				windowsHide: true,
			});
			child.stdout?.on('data', (data: Buffer) => write(data.toString()));
			child.stderr?.on('data', (data: Buffer) => write(data.toString()));
			child.on('error', (error) => {
				write(`\n${error.message}\n`);
				child = undefined;
			});
			child.on('close', (code) => {
				write(`\n${vscode.l10n.t('Process exited with code {0}.', String(code ?? '?'))}\n`);
				child = undefined;
			});
		},
		close: () => {
			child?.kill();
			child = undefined;
			writeEmitter.dispose();
			closeEmitter.dispose();
		},
		handleInput: (data: string) => {
			if (!child?.stdin) {
				return;
			}
			// Echo typed text so programs that read stdin are usable.
			const text = data === '\r' ? '\n' : data;
			write(text);
			child.stdin.write(text);
		},
	};

	return vscode.window.createTerminal({ name, pty });
}
