import * as vscode from 'vscode';
import { allSelections, chooseProgram, Choice, ProgramRequest, Selection, selectionKey } from '../core/programs';
import { pickProgram } from '../ui/programPicker';
import { cargoFor, readWorkspace, toolchainLibDir } from './cargoTools';
import { CargoProjects } from './projects';
import { RunSession } from './runner';

/**
 * Turns "Run was pressed" into a RunSession: which workspace, which
 * program and which cargo. The user is asked only when the workspace has
 * several programs and nothing says which one is meant; the answer is
 * remembered per workspace.
 */

export interface SessionRequest {
	/** The file Run was pressed for. */
	file?: string;
	/** A ▶ Run button's package folder… */
	cwd?: string;
	/** …and the program it names. */
	program?: ProgramRequest;
	/** Always show the program list (Choose Program). */
	pick?: boolean;
}

/** workspaceState key: { [workspace root]: selectionKey }. */
const REMEMBERED_KEY = 'atm.cargo.programs';

export class SessionResolver {
	constructor(
		private readonly memento: vscode.Memento,
		private readonly projects: CargoProjects,
	) {}

	/** The session to run, or undefined when there is nothing to run or the user cancelled. Rejects with cargo's error. */
	async resolve(request: SessionRequest): Promise<RunSession | undefined> {
		const dir = request.cwd ?? (request.file ? await this.projects.manifestDir(request.file) : undefined) ?? (await this.pickWorkspaceProject());
		if (!dir) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Cargo Run: open a Rust file or a folder with a Cargo.toml.'));
			return undefined;
		}

		const cargo = await cargoFor(dir);
		const workspace = await readWorkspace(cargo, dir);
		const choice: Choice = request.pick
			? { kind: 'ask', candidates: allSelections(workspace) }
			: chooseProgram(workspace, { request: request.program, file: request.file, remembered: this.remembered(workspace.root) });
		const candidates = choice.kind === 'ask' ? choice.candidates : [];
		if (choice.kind === 'none' || (choice.kind === 'ask' && candidates.length === 0)) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('Cargo Run: this workspace has no program to run. Add src/main.rs, a file in src/bin/ or a [[bin]] in Cargo.toml.'),
			);
			return undefined;
		}
		const selection = choice.kind === 'selected' ? choice.selection : await pickProgram(candidates, workspace.root);
		if (!selection) {
			return undefined;
		}
		await this.remember(workspace.root, selection);

		const libDir = await toolchainLibDir(cargo, workspace.root);
		return { cargo, workspace, selection, cwd: workspace.root, toolchainLibDirs: libDir ? [libDir] : [] };
	}

	/** With no file open: the folder's Cargo project, or a choice between several. */
	private async pickWorkspaceProject(): Promise<string | undefined> {
		const projects = await this.projects.workspaceProjects();
		if (projects.length <= 1) {
			return projects[0];
		}
		const picked = await vscode.window.showQuickPick(
			projects.map((dir) => ({ label: vscode.workspace.asRelativePath(dir, true), dir })),
			{ placeHolder: vscode.l10n.t('Which Cargo project should Cargo Run start?') },
		);
		return picked?.dir;
	}

	private remembered(root: string): string | undefined {
		return this.memento.get<Record<string, string>>(REMEMBERED_KEY, {})[root];
	}

	private async remember(root: string, selection: Selection): Promise<void> {
		const all = this.memento.get<Record<string, string>>(REMEMBERED_KEY, {});
		await this.memento.update(REMEMBERED_KEY, { ...all, [root]: selectionKey(selection) });
	}
}
