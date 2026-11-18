import * as vscode from 'vscode';
import { isRunnable, runnableToProcess } from '../core/runnables';
import { CARGO_TASK_TYPE, RUSTC_PROBLEM_MATCHER } from '../providers/cargoTasks';
import { RustServer } from '../host/server';
import { findTool } from '../host/toolchain';
import { openRunTerminal } from './runTerminal';

export const OPEN_DOCS = 'atm.rust.openDocs';
export const RESTART_SERVER = 'atm.rust.restartServer';
export const INSTALL_SERVER = 'atm.rust.installServer';

export interface RustCommandHost {
	server: RustServer;
	restart(): Promise<void>;
	install(): Promise<void>;
}

export function registerRustCommands(host: RustCommandHost): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(OPEN_DOCS, () => openDocs(host.server)),
		vscode.commands.registerCommand(RESTART_SERVER, () => host.restart()),
		vscode.commands.registerCommand(INSTALL_SERVER, () => host.install()),
		// Commands rust-analyzer attaches to its buttons and completions (see core/commandMap.ts).
		vscode.commands.registerCommand('atm.rust.runSingle', (runnable: unknown) => runSingle(runnable)),
		vscode.commands.registerCommand('atm.rust.showReferences', (uri: string, position: unknown, locations: unknown[]) =>
			showReferences(host.server, uri, position, locations),
		),
		vscode.commands.registerCommand('atm.rust.gotoLocation', (location: unknown) => gotoLocation(host.server, location)),
		vscode.commands.registerCommand('atm.rust.triggerParameterHints', () =>
			vscode.commands.executeCommand('editor.action.triggerParameterHints'),
		),
		vscode.commands.registerCommand('atm.rust.rename', () => vscode.commands.executeCommand('editor.action.rename')),
		vscode.window.onDidCloseTerminal((terminal) => {
			for (const [label, open] of looseTerminals) {
				if (open === terminal) {
					looseTerminals.delete(label);
				}
			}
		}),
	];
}

async function openDocs(server: RustServer): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'rust') {
		return;
	}
	if (!server.isRunning) {
		void vscode.window.showInformationMessage(vscode.l10n.t('ATM Rust: Open Docs needs the rust-analyzer program.'));
		return;
	}
	const url = await server.externalDocs(editor.document, editor.selection.active);
	if (!url) {
		vscode.window.setStatusBarMessage(vscode.l10n.t('ATM Rust: no documentation found for this item.'), 3000);
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(url));
}

/** Terminals opened by Run when no folder is open, by label, so a second click replaces the first. */
const looseTerminals = new Map<string, vscode.Terminal>();

/** ▶ Run / Run Test: runs the command rust-analyzer describes in a terminal. */
async function runSingle(runnable: unknown): Promise<void> {
	if (!isRunnable(runnable)) {
		return;
	}
	const cwdHint = 'cwd' in runnable.args ? runnable.args.cwd : undefined;
	const cargo = (await findTool('cargo', cwdHint)) ?? 'cargo';
	const spec = runnableToProcess(runnable, cargo);
	const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(spec.cwd));

	if (!folder) {
		// VS Code runs tasks only inside a folder, so a file opened on its own gets a plain terminal.
		looseTerminals.get(runnable.label)?.dispose();
		const terminal = openRunTerminal(runnable.label, spec);
		looseTerminals.set(runnable.label, terminal);
		terminal.show(true);
		return;
	}

	const definition = { type: CARGO_TASK_TYPE, command: spec.args[0] ?? runnable.label };
	const task = new vscode.Task(
		definition,
		folder,
		runnable.label,
		'ATM Rust',
		new vscode.ProcessExecution(spec.command, spec.args, { cwd: spec.cwd, env: spec.env }),
		RUSTC_PROBLEM_MATCHER,
	);
	task.presentationOptions = { clear: true, focus: false, reveal: vscode.TaskRevealKind.Always };
	await vscode.tasks.executeTask(task);
}

async function showReferences(server: RustServer, uri: string, position: unknown, locations: unknown[]): Promise<void> {
	const client = server.languageClient;
	if (!client || typeof uri !== 'string' || !Array.isArray(locations)) {
		return;
	}
	const converter = client.protocol2CodeConverter;
	await vscode.commands.executeCommand(
		'editor.action.showReferences',
		vscode.Uri.parse(uri),
		converter.asPosition(position as Parameters<typeof converter.asPosition>[0]),
		locations.map((location) => converter.asLocation(location as Parameters<typeof converter.asLocation>[0])),
	);
}

async function gotoLocation(server: RustServer, location: unknown): Promise<void> {
	const client = server.languageClient;
	if (!client || typeof location !== 'object' || location === null) {
		return;
	}
	const target = client.protocol2CodeConverter.asLocation(location as Parameters<typeof client.protocol2CodeConverter.asLocation>[0]);
	if (!target) {
		return;
	}
	await vscode.window.showTextDocument(target.uri, { selection: target.range });
}
