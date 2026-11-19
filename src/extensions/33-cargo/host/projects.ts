import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isInside } from '../core/paths';

/**
 * Finds Cargo projects from the files the user has open: the nearest
 * Cargo.toml above a file. Answers are cached per folder, so switching tabs
 * costs nothing after the first look, and the cache is dropped when a
 * Cargo.toml is created or deleted.
 */

/** Folder lookups kept before the cache starts over. */
const MAX_CACHED_DIRS = 1000;
/** Folders that are never projects of their own, when looking one level down. */
const SKIPPED_DIRS = new Set(['target', 'node_modules']);

export class CargoProjects implements vscode.Disposable {
	private readonly cache = new Map<string, Promise<string | undefined>>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly disposables: vscode.Disposable[];

	constructor() {
		// Editing a Cargo.toml doesn't move a project; only adding or removing one does.
		const watcher = vscode.workspace.createFileSystemWatcher('**/Cargo.toml', false, true, false);
		const reset = () => {
			this.cache.clear();
			this.changed.fire();
		};
		this.disposables = [this.changed, watcher, watcher.onDidCreate(reset), watcher.onDidDelete(reset)];
	}

	/** Folder of the nearest Cargo.toml above `file`. Rust's own sources and downloaded crates don't count. */
	manifestDir(file: string): Promise<string | undefined> {
		return isToolchainFile(file) ? Promise.resolve(undefined) : this.lookUp(path.dirname(file));
	}

	/** Cargo projects of the open folders: a Cargo.toml at the top, or else one level down (Tauri's src-tauri/). */
	async workspaceProjects(): Promise<string[]> {
		const projects: string[] = [];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			if (folder.uri.scheme !== 'file') {
				continue;
			}
			const root = folder.uri.fsPath;
			if (await isFile(path.join(root, 'Cargo.toml'))) {
				projects.push(root);
				continue;
			}
			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(root, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				const dir = path.join(root, entry.name);
				if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name) && (await isFile(path.join(dir, 'Cargo.toml')))) {
					projects.push(dir);
				}
			}
		}
		return projects;
	}

	private lookUp(dir: string): Promise<string | undefined> {
		let found = this.cache.get(dir);
		if (!found) {
			if (this.cache.size >= MAX_CACHED_DIRS) {
				this.cache.clear();
			}
			found = isFile(path.join(dir, 'Cargo.toml')).then((exists) => {
				const parent = path.dirname(dir);
				return exists ? dir : parent === dir ? undefined : this.lookUp(parent);
			});
			this.cache.set(dir, found);
		}
		return found;
	}

	dispose(): void {
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

/** The file in the active editor, when it is a file on disk. */
export function activeFile(): string | undefined {
	const uri = vscode.window.activeTextEditor?.document.uri;
	return uri?.scheme === 'file' ? uri.fsPath : undefined;
}

async function isFile(file: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(file)).isFile();
	} catch {
		return false;
	}
}

/** The standard library's sources and downloaded crates belong to the toolchain, not the user's project. */
function isToolchainFile(file: string): boolean {
	const home = os.homedir();
	const roots = [process.env.CARGO_HOME || path.join(home, '.cargo'), process.env.RUSTUP_HOME || path.join(home, '.rustup')];
	return roots.some((root) => isInside(root, file));
}
