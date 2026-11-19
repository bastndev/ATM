import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_EDITION, readEdition } from '../core/edition';
import { findTool, runRustfmt } from '../host/toolchain';

/**
 * Formatting with rustfmt. Only used in trusted folders, because rustup may
 * run a toolchain the project points to.
 */
export class RustfmtFormatter implements vscode.DocumentFormattingEditProvider {
	async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
		if (!vscode.workspace.isTrusted) {
			return [];
		}
		const dir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
		const rustfmt = await findTool('rustfmt', dir);
		if (!rustfmt) {
			void vscode.window.setStatusBarMessage(vscode.l10n.t('ATM Rust: rustfmt was not found.'), 4000);
			return [];
		}
		const source = document.getText();
		const edition = dir ? await findEdition(dir) : DEFAULT_EDITION;
		const formatted = await runRustfmt(rustfmt, source, edition, dir);
		if (formatted === undefined) {
			void vscode.window.setStatusBarMessage(vscode.l10n.t('ATM Rust: rustfmt could not format this file (check for syntax errors).'), 4000);
			return [];
		}
		if (formatted === source) {
			return [];
		}
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
		return [vscode.TextEdit.replace(fullRange, formatted)];
	}
}

/** Walks up from the file's folder to the Cargo.toml that names the edition. */
export async function findEdition(startDir: string): Promise<string> {
	let dir = startDir;
	let inherited = false;
	for (;;) {
		const manifest = path.join(dir, 'Cargo.toml');
		const text = await fs.promises.readFile(manifest, 'utf8').catch(() => undefined);
		if (text !== undefined) {
			const found = readEdition(text);
			if (found && 'edition' in found) {
				return found.edition;
			}
			if (found) {
				inherited = true;
			} else if (!inherited && /^\s*\[package\]/m.test(text)) {
				// A crate without `edition` uses 2015.
				return '2015';
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return DEFAULT_EDITION;
		}
		dir = parent;
	}
}
