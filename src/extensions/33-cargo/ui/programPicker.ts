import * as path from 'path';
import * as vscode from 'vscode';
import { Selection } from '../core/programs';

/** Asks which program to start when a workspace has several. */
export async function pickProgram(candidates: readonly Selection[], workspaceRoot: string): Promise<Selection | undefined> {
	const items = candidates.map((selection) => ({
		label: `$(${selection.program.kind === 'bin' ? 'play' : 'beaker'}) ${selection.program.name}`,
		description: selection.program.kind === 'example' ? vscode.l10n.t('example in {0}', selection.pkg.name) : selection.pkg.name,
		detail: path.relative(workspaceRoot, selection.program.srcPath),
		selection,
	}));
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: vscode.l10n.t('Which program should Cargo Run start? It is remembered for this workspace.'),
		matchOnDescription: true,
		matchOnDetail: true,
	});
	return picked?.selection;
}
