import * as fs from 'fs';
import * as vscode from 'vscode';
import { ProjectFiles } from '../core/cargoTarget';

const MAX_CACHED = 64;

/**
 * Reads Cargo.toml and crate roots for the Run buttons. An open file gives
 * its editor text, so unsaved edits count; other files come from disk and
 * are cached until their size or modification time changes.
 */
export class EditorProjectFiles implements ProjectFiles {
	private readonly cache = new Map<string, { mtimeMs: number; size: number; text: string }>();

	async read(file: string): Promise<string | undefined> {
		const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && document.uri.fsPath === file);
		if (open) {
			return open.getText();
		}
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(file);
		} catch {
			this.cache.delete(file);
			return undefined;
		}
		if (!stat.isFile()) {
			return undefined;
		}
		const cached = this.cache.get(file);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
			return cached.text;
		}
		try {
			const text = await fs.promises.readFile(file, 'utf8');
			this.cache.delete(file);
			this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text });
			if (this.cache.size > MAX_CACHED) {
				const oldest = this.cache.keys().next().value;
				if (oldest !== undefined) {
					this.cache.delete(oldest);
				}
			}
			return text;
		} catch {
			return undefined;
		}
	}
}
