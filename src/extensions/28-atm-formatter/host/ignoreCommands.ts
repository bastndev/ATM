import * as path from 'path';
import * as vscode from 'vscode';
import { literalIgnorePattern } from '../core/ignoreResolver';

type WorkspaceResources = {
	folder: vscode.WorkspaceFolder;
	resources: vscode.Uri[];
};

async function readIgnoreFile(uri: vscode.Uri): Promise<string> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return '';
		}
		throw error;
	}
}

async function toIgnorePattern(folder: vscode.WorkspaceFolder, resource: vscode.Uri): Promise<string | undefined> {
	const relativePath = path.relative(folder.uri.fsPath, resource.fsPath).split(path.sep).join('/');
	if (!relativePath || relativePath.startsWith('../')) {
		return undefined;
	}

	const stat = await vscode.workspace.fs.stat(resource);
	return literalIgnorePattern(relativePath, (stat.type & vscode.FileType.Directory) !== 0);
}

async function appendPatterns(uri: vscode.Uri, patterns: string[]): Promise<number> {
	const content = await readIgnoreFile(uri);
	const existing = new Set(
		content
			.split(/\r?\n/)
			.filter(Boolean),
	);
	const additions = patterns.filter((pattern) => !existing.has(pattern));
	if (additions.length === 0) {
		return 0;
	}

	const newline = content.includes('\r\n') ? '\r\n' : '\n';
	const separator = content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r') ? newline : '';
	await vscode.workspace.fs.writeFile(
		uri,
		new TextEncoder().encode(`${content}${separator}${additions.join(newline)}${newline}`),
	);
	return additions.length;
}

export async function addResourcesToIgnoreFile(
	ignoreFileName: '.atmignore' | '.prettierignore',
	resourceUri: vscode.Uri | undefined,
	selectedUris: readonly vscode.Uri[] | undefined,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const resources = selectedUris?.length ? selectedUris : resourceUri ? [resourceUri] : [];
	if (resources.length === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: no file or folder selected'));
		return;
	}

	const byWorkspace = new Map<string, WorkspaceResources>();
	for (const resource of resources) {
		if (resource.scheme !== 'file') { continue; }
		const folder = vscode.workspace.getWorkspaceFolder(resource);
		if (!folder) { continue; }
		const group = byWorkspace.get(folder.uri.toString()) ?? { folder, resources: [] };
		group.resources.push(resource);
		byWorkspace.set(folder.uri.toString(), group);
	}

	if (byWorkspace.size === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t('ATM Formatter: selection is outside the workspace'));
		return;
	}

	try {
		let added = 0;
		for (const { folder, resources: workspaceResources } of byWorkspace.values()) {
			const patterns = (await Promise.all(
				workspaceResources.map((resource) => toIgnorePattern(folder, resource)),
			)).filter((pattern): pattern is string => pattern !== undefined);
			added += await appendPatterns(vscode.Uri.joinPath(folder.uri, ignoreFileName), patterns);
		}

		if (added === 0) {
			vscode.window.showInformationMessage(vscode.l10n.t('ATM Formatter: selection is already in {0}', ignoreFileName));
			return;
		}

		outputChannel.appendLine(`[formatter] Added ${added} item(s) to ${ignoreFileName}`);
		vscode.window.showInformationMessage(vscode.l10n.t('ATM Formatter: added {0} item(s) to {1}', added, ignoreFileName));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(`[formatter] Failed to update ${ignoreFileName}: ${message}`);
		vscode.window.showErrorMessage(vscode.l10n.t('ATM Formatter: could not update {0}', ignoreFileName));
	}
}
