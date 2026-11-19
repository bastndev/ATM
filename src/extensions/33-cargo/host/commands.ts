import * as vscode from 'vscode';
import { parseRunArgs } from '../core/programs';
import { CargoController } from './controller';
import { activeFile } from './projects';
import { SessionRequest } from './session';

/** Also called by 32-rust's ▶ Run button above main(), by name, so the two modules don't import each other. */
export const RUN_COMMAND = 'atm.cargo.run';

export function registerCargoCommands(controller: CargoController): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(RUN_COMMAND, (arg?: unknown) => controller.run(toRequest(arg))),
		vscode.commands.registerCommand('atm.cargo.selectProgram', () => controller.run({ file: activeFile(), pick: true })),
		vscode.commands.registerCommand('atm.cargo.toggle', () => controller.toggle()),
		vscode.commands.registerCommand('atm.cargo.restart', () => controller.restart()),
		vscode.commands.registerCommand('atm.cargo.stop', () => controller.stop()),
		vscode.commands.registerCommand('atm.cargo.showOutput', () => controller.showOutput()),
	];
}

/** What Run was pressed for: the editor title passes its file, a ▶ Run button passes its cargo command. */
function toRequest(arg: unknown): SessionRequest {
	if (arg instanceof vscode.Uri) {
		return { file: arg.scheme === 'file' ? arg.fsPath : activeFile() };
	}
	if (isRunButton(arg)) {
		return { cwd: arg.cwd, program: parseRunArgs(arg.cargoArgs), file: activeFile() };
	}
	return { file: activeFile() };
}

/** The shape of 32-rust's Runnable for a program: `cargo run --package … --bin …` in a package folder. */
function isRunButton(value: unknown): value is { cwd: string; cargoArgs: string[] } {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { cwd?: unknown; cargoArgs?: unknown };
	return (
		typeof candidate.cwd === 'string' &&
		Array.isArray(candidate.cargoArgs) &&
		candidate.cargoArgs.every((arg) => typeof arg === 'string') &&
		candidate.cargoArgs[0] === 'run'
	);
}
