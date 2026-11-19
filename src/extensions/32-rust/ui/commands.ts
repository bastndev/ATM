import * as path from 'path';
import * as vscode from 'vscode';
import { isRunnable, Runnable, runnableToProcess } from '../core/runnables';
import { findTool, toolCommand } from '../host/toolchain';
import { CARGO_TASK_TYPE, RUST_PANIC_PROBLEM_MATCHER, RUSTC_PROBLEM_MATCHER } from '../providers/cargoTasks';
import { RUN_COMMAND } from '../providers/runLens';
import { openRunTerminal } from './runTerminal';

/** Terminals opened by Run when no folder is open, by label, so a second click replaces the first. */
const looseTerminals = new Map<string, vscode.Terminal>();

/** 33-cargo's Run, called by name so the two modules don't import each other. */
const CARGO_RUN_COMMAND = 'atm.cargo.run';

export function registerRustCommands(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(RUN_COMMAND, (runnable: unknown) => run(runnable)),
		vscode.window.onDidCloseTerminal((terminal) => {
			for (const [label, open] of looseTerminals) {
				if (open === terminal) {
					looseTerminals.delete(label);
				}
			}
		}),
	];
}

/**
 * ▶ Run / Run Test: a program goes to Cargo Run (33-cargo); tests, and
 * programs when Cargo Run is off, run as a cargo task, so compiler errors
 * and panics become clickable problems. Building runs the project's own
 * code (build.rs, macros), so nothing runs in an untrusted folder.
 */
async function run(runnable: unknown): Promise<void> {
	if (!isRunnable(runnable) || !vscode.workspace.isTrusted) {
		return;
	}
	if (runnable.cargoArgs[0] === 'run' && (await handOffToCargoRun(runnable))) {
		return;
	}
	const cargo = (await findTool('cargo', runnable.cwd)) ?? toolCommand('cargo');
	const spec = runnableToProcess(runnable, cargo);
	const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(spec.cwd));

	if (!folder) {
		// VS Code runs tasks only inside a folder, so a file opened on its own gets a plain terminal.
		// Tasks save the editors first (task.saveBeforeRun); do the same here.
		if (vscode.workspace.getConfiguration('task').get<string>('saveBeforeRun', 'always') === 'always') {
			await vscode.workspace.saveAll(false);
		}
		looseTerminals.get(runnable.label)?.dispose();
		const terminal = openRunTerminal(runnable.label, spec);
		looseTerminals.set(runnable.label, terminal);
		terminal.show(true);
		return;
	}

	const definition: vscode.TaskDefinition = { type: CARGO_TASK_TYPE, command: spec.args[0], args: spec.args.slice(1), env: spec.env };
	const cwd = path.relative(folder.uri.fsPath, spec.cwd);
	if (cwd) {
		definition.cwd = cwd;
	}
	const task = new vscode.Task(
		definition,
		folder,
		runnable.label,
		'ATM Rust',
		new vscode.ProcessExecution(spec.command, spec.args, { cwd: spec.cwd, env: spec.env }),
		[RUSTC_PROBLEM_MATCHER, RUST_PANIC_PROBLEM_MATCHER],
	);
	task.presentationOptions = { clear: true, focus: false, reveal: vscode.TaskRevealKind.Always };
	await vscode.tasks.executeTask(task);
}

/**
 * A program (not a test) goes to Cargo Run, which keeps a single copy
 * running and restarts it with Ctrl+G. False when Cargo Run is turned off
 * or not loaded; then the program runs as a plain cargo task.
 */
async function handOffToCargoRun(runnable: Runnable): Promise<boolean> {
	try {
		return (await vscode.commands.executeCommand<boolean>(CARGO_RUN_COMMAND, runnable)) === true;
	} catch {
		return false;
	}
}
