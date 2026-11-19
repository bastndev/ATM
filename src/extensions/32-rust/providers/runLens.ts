import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findFileTarget, ProjectFiles } from '../core/cargoTarget';
import { buildRunnable, commandLine } from '../core/runnables';
import { findRunTargets, RunTargetKind } from '../core/runTargets';
import { RustTokenCache } from './tokenCache';

export const RUN_COMMAND = 'atm.rust.run';

const TITLES: Record<RunTargetKind, () => string> = {
	main: () => vscode.l10n.t('Run'),
	test: () => vscode.l10n.t('Run Test'),
	testModule: () => vscode.l10n.t('Run Tests'),
};

/**
 * ▶ Run above `fn main()`, ▶ Run Test above each test and ▶ Run Tests above
 * test modules. Everything comes from reading the open file and its
 * Cargo.toml, so the buttons show up at once and cost almost no memory.
 */
export class RunLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;
	private readonly disposables: vscode.Disposable[];

	constructor(
		private readonly tokens: RustTokenCache,
		private readonly files: ProjectFiles,
	) {
		// Cargo.toml decides the target, and a crate root decides which modules exist.
		const watcher = vscode.workspace.createFileSystemWatcher('**/Cargo.toml');
		const refresh = () => this.changed.fire();
		this.disposables = [
			this.changed,
			watcher,
			watcher.onDidChange(refresh),
			watcher.onDidCreate(refresh),
			watcher.onDidDelete(refresh),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.languageId === 'rust') {
					refresh();
				}
			}),
		];
	}

	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		if (document.uri.scheme !== 'file' || isToolchainSource(document.uri.fsPath)) {
			return [];
		}
		const targets = findRunTargets(this.tokens.get(document));
		if (targets.length === 0) {
			return [];
		}
		// Positions are taken now, before the document can change during the wait below.
		const ranges = targets.map((target) => {
			const position = document.positionAt(target.offset);
			return new vscode.Range(position, position);
		});
		const fileTarget = await findFileTarget(document.uri.fsPath, this.files);
		if (!fileTarget || token.isCancellationRequested) {
			return [];
		}
		const lenses: vscode.CodeLens[] = [];
		targets.forEach((target, index) => {
			const runnable = buildRunnable(target, fileTarget);
			if (runnable) {
				lenses.push(
					new vscode.CodeLens(ranges[index], {
						title: `▶︎ ${TITLES[target.kind]()}`,
						tooltip: commandLine(runnable),
						command: RUN_COMMAND,
						arguments: [runnable],
					}),
				);
			}
		});
		return lenses;
	}

	dispose(): void {
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

/** The standard library's sources and downloaded crates are not the user's project. */
function isToolchainSource(file: string): boolean {
	const home = os.homedir();
	const roots = [process.env.CARGO_HOME || path.join(home, '.cargo'), process.env.RUSTUP_HOME || path.join(home, '.rustup')];
	return roots.some((root) => {
		const relative = path.relative(root, file);
		return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	});
}
