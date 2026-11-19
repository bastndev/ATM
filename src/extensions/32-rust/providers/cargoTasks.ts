import * as path from 'path';
import * as vscode from 'vscode';
import { NO_AUTO_INSTALL } from '../core/rustup';
import { findTool, toolCommand } from '../host/toolchain';

export const CARGO_TASK_TYPE = 'atm-cargo';
export const RUSTC_PROBLEM_MATCHER = '$atm-rustc';
/** Turns `thread 'main' panicked at src/main.rs:4:5:` into a clickable problem. */
export const RUST_PANIC_PROBLEM_MATCHER = '$atm-rust-panic';
const TASK_SOURCE = 'ATM Rust';

interface CargoTaskDefinition extends vscode.TaskDefinition {
	type: typeof CARGO_TASK_TYPE;
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

/** The commands offered in "Run Task" for every Cargo project. */
const COMMANDS: ReadonlyArray<{ command: string; group?: vscode.TaskGroup }> = [
	{ command: 'build', group: vscode.TaskGroup.Build },
	{ command: 'check', group: vscode.TaskGroup.Build },
	{ command: 'clippy', group: vscode.TaskGroup.Build },
	{ command: 'test', group: vscode.TaskGroup.Test },
	{ command: 'clean', group: vscode.TaskGroup.Clean },
	{ command: 'run' },
];

/**
 * "Run Task" entries for cargo build, check, clippy, test, clean and run.
 * Projects are found by a Cargo.toml in the folder or one level down, which
 * covers Tauri's src-tauri/ layout.
 */
export class CargoTaskProvider implements vscode.TaskProvider {
	async provideTasks(): Promise<vscode.Task[]> {
		const tasks: vscode.Task[] = [];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const projects = await findCargoProjects(folder);
			for (const project of projects) {
				const suffix = projects.length > 1 || project !== folder.uri.fsPath ? ` (${path.relative(folder.uri.fsPath, project) || '.'})` : '';
				for (const { command, group } of COMMANDS) {
					const definition: CargoTaskDefinition = { type: CARGO_TASK_TYPE, command };
					if (project !== folder.uri.fsPath) {
						definition.cwd = path.relative(folder.uri.fsPath, project);
					}
					const task = await createCargoTask(definition, folder, `cargo ${command}${suffix}`);
					task.group = group;
					tasks.push(task);
				}
			}
		}
		return tasks;
	}

	async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		const definition = task.definition as CargoTaskDefinition;
		if (definition.type !== CARGO_TASK_TYPE || typeof definition.command !== 'string') {
			return undefined;
		}
		const scope = task.scope && typeof task.scope === 'object' ? task.scope : vscode.workspace.workspaceFolders?.[0];
		if (!scope) {
			return undefined;
		}
		return createCargoTask(definition, scope, task.name);
	}
}

async function createCargoTask(definition: CargoTaskDefinition, folder: vscode.WorkspaceFolder, name: string): Promise<vscode.Task> {
	const cwd = definition.cwd ? path.resolve(folder.uri.fsPath, definition.cwd) : folder.uri.fsPath;
	const cargo = (await findTool('cargo', cwd)) ?? toolCommand('cargo');
	const execution = new vscode.ProcessExecution(cargo, [definition.command, ...(definition.args ?? [])], {
		cwd,
		env: { ...NO_AUTO_INSTALL, ...definition.env },
	});
	return new vscode.Task(definition, folder, name, TASK_SOURCE, execution, RUSTC_PROBLEM_MATCHER);
}

/** Folders holding a Cargo.toml: the root one, or else the ones a level down. */
async function findCargoProjects(folder: vscode.WorkspaceFolder): Promise<string[]> {
	const root = vscode.Uri.joinPath(folder.uri, 'Cargo.toml');
	try {
		await vscode.workspace.fs.stat(root);
		return [folder.uri.fsPath];
	} catch {
		// No Cargo.toml at the root; look one level down.
	}
	const manifests = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '*/Cargo.toml'), '**/target/**', 20);
	return manifests.map((uri) => path.dirname(uri.fsPath)).sort();
}
