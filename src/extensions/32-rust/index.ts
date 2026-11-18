import * as path from 'path';
import * as vscode from 'vscode';
import { buildServerConfig, RustSettings } from './core/serverConfig';
import { InstallPrompt } from './host/install';
import { RustServer } from './host/server';
import { clearToolCache, findTool } from './host/toolchain';
import { BasicTypeHintsProvider } from './providers/basicHints';
import { CARGO_TASK_TYPE, CargoTaskProvider } from './providers/cargoTasks';
import { MutUnderline } from './providers/mutUnderline';
import { RustfmtFormatter } from './providers/rustfmt';
import { RustTokenCache } from './providers/tokenCache';
import { registerRustCommands } from './ui/commands';

/** The official rust-analyzer extension. When it is installed, ATM's Rust support stays off. */
export const OFFICIAL_RUST_EXTENSION = 'rust-lang.rust-analyzer';

const RUST: vscode.DocumentSelector = { language: 'rust', scheme: 'file' };
const SECTION = 'atm.rust';

/**
 * Rust support. With the rust-analyzer program (installed with Rust, not an
 * extension) ATM connects to it for completions, hover, go to definition,
 * quick fixes, rename, type and parameter hints, rustfmt, errors and Run
 * buttons. Without it, ATM still shows simple type hints, underlines `mut`
 * variables and formats with rustfmt. Cargo tasks work either way.
 */
export function activateRust(context: vscode.ExtensionContext): void {
	context.subscriptions.push(new RustController(context));
}

type Mode = 'off' | 'basic' | 'full';

class RustController implements vscode.Disposable {
	private readonly output = vscode.window.createOutputChannel('ATM Rust');
	private readonly tokens = new RustTokenCache();
	private readonly server = new RustServer(this.output, () => buildServerConfig(readSettings()));
	private readonly installPrompt: InstallPrompt;
	private readonly disposables: vscode.Disposable[] = [];
	private basicFeatures: vscode.Disposable[] = [];
	private taskProvider: vscode.Disposable | undefined;
	private starting: Promise<void> | undefined;
	private refreshing: Promise<void> = Promise.resolve();
	private mode: Mode | undefined;

	constructor(context: vscode.ExtensionContext) {
		this.installPrompt = new InstallPrompt(context, this.output);
		this.disposables.push(
			this.output,
			this.tokens,
			this.server,
			...registerRustCommands({
				server: this.server,
				restart: () => this.restart(),
				install: () => this.install(),
			}),
			this.server.onDidChangeRunning(() => this.applyMode()),
			vscode.workspace.onDidOpenTextDocument((document) => {
				if (document.languageId === 'rust') {
					this.refresh();
				}
			}),
			vscode.workspace.onDidChangeConfiguration((event) => this.onConfigChanged(event)),
			vscode.workspace.onDidGrantWorkspaceTrust(() => {
				// Rebuild the basic features so rustfmt is added.
				this.mode = undefined;
				this.refresh();
			}),
			vscode.extensions.onDidChange(() => this.refresh()),
		);
		this.refresh();
	}

	/** Re-evaluates what should run. Calls are queued so they never overlap. */
	private refresh(): void {
		this.refreshing = this.refreshing.then(() => this.doRefresh()).catch((error: unknown) => {
			this.output.appendLine(`ATM Rust: ${String(error)}`);
		});
	}

	private async doRefresh(): Promise<void> {
		if (!this.isActive()) {
			await this.server.stop();
			this.applyMode();
			return;
		}
		if (vscode.workspace.isTrusted && !this.taskProvider) {
			this.taskProvider = vscode.tasks.registerTaskProvider(CARGO_TASK_TYPE, new CargoTaskProvider());
		}
		this.applyMode();
		if (vscode.workspace.isTrusted && hasRustDocument() && !this.server.isRunning && !this.starting) {
			this.starting = this.startServer().finally(() => {
				this.starting = undefined;
			});
			await this.starting;
		}
	}

	private isActive(): boolean {
		return vscode.workspace.getConfiguration(SECTION).get<boolean>('enabled', true) && !vscode.extensions.getExtension(OFFICIAL_RUST_EXTENSION);
	}

	private async startServer(): Promise<void> {
		const cwd = rustWorkingDirectory();
		const explicitPath = vscode.workspace.getConfiguration(SECTION).get<string>('serverPath', '').trim();
		const serverPath = await findTool('rust-analyzer', cwd, explicitPath || undefined);
		void vscode.commands.executeCommand('setContext', 'atm.rust.serverMissing', !serverPath);
		if (!serverPath) {
			this.output.appendLine(
				explicitPath
					? `rust-analyzer did not run from atm.rust.serverPath (${explicitPath}).`
					: 'rust-analyzer was not found. Simple type hints, the mut underline and rustfmt stay on.',
			);
			if (!explicitPath) {
				// Not awaited: the notification can stay open for a long time.
				void this.installPrompt.offer(cwd).then((installed) => {
					if (installed) {
						void this.restart();
					}
				});
			}
			return;
		}
		this.output.appendLine(`Starting ${serverPath}`);
		await this.server.start(serverPath, cwd);
	}

	/** Basic features run only while rust-analyzer does not, so nothing shows up twice. */
	private applyMode(): void {
		const mode: Mode = !this.isActive() ? 'off' : this.server.isRunning ? 'full' : 'basic';
		void vscode.commands.executeCommand('setContext', 'atm.rust.serverRunning', mode === 'full');
		if (mode === 'off') {
			this.taskProvider?.dispose();
			this.taskProvider = undefined;
		}
		if (mode === this.mode) {
			return;
		}
		this.mode = mode;
		this.disposeBasicFeatures();
		if (mode === 'basic') {
			this.basicFeatures = this.createBasicFeatures();
		}
	}

	private createBasicFeatures(): vscode.Disposable[] {
		const features: vscode.Disposable[] = [new MutUnderline(this.tokens)];
		if (readSettings().typeHints) {
			features.push(vscode.languages.registerInlayHintsProvider(RUST, new BasicTypeHintsProvider(this.tokens)));
		}
		if (vscode.workspace.isTrusted) {
			features.push(vscode.languages.registerDocumentFormattingEditProvider(RUST, new RustfmtFormatter()));
		}
		return features;
	}

	private disposeBasicFeatures(): void {
		this.basicFeatures.forEach((feature) => feature.dispose());
		this.basicFeatures = [];
	}

	private onConfigChanged(event: vscode.ConfigurationChangeEvent): void {
		if (!event.affectsConfiguration(SECTION)) {
			return;
		}
		if (event.affectsConfiguration(`${SECTION}.enabled`) || event.affectsConfiguration(`${SECTION}.serverPath`)) {
			void this.restart();
			return;
		}
		this.server.notifyConfigChanged();
		if (this.mode === 'basic') {
			// Rebuild so a changed hint setting takes effect.
			this.mode = undefined;
			this.applyMode();
		}
	}

	private async restart(): Promise<void> {
		clearToolCache();
		await this.server.stop();
		this.refresh();
		await this.refreshing;
	}

	private async install(): Promise<void> {
		if (await this.installPrompt.install(rustWorkingDirectory())) {
			await this.restart();
		}
	}

	dispose(): void {
		this.disposeBasicFeatures();
		this.taskProvider?.dispose();
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}

function readSettings(): RustSettings {
	const config = vscode.workspace.getConfiguration(SECTION);
	return {
		checkCommand: config.get<string>('checkOnSave.command') === 'clippy' ? 'clippy' : 'check',
		typeHints: config.get<boolean>('inlayHints.typeHints', true),
		parameterHints: config.get<boolean>('inlayHints.parameterHints', true),
	};
}

function hasRustDocument(): boolean {
	return vscode.workspace.textDocuments.some((document) => document.languageId === 'rust' && document.uri.scheme === 'file');
}

/** Folder used as the working directory for rust-analyzer and rustup (rust-toolchain.toml is read from here). */
function rustWorkingDirectory(): string | undefined {
	const rustDocument = vscode.workspace.textDocuments.find((document) => document.languageId === 'rust' && document.uri.scheme === 'file');
	if (rustDocument) {
		const folder = vscode.workspace.getWorkspaceFolder(rustDocument.uri);
		return folder ? folder.uri.fsPath : path.dirname(rustDocument.uri.fsPath);
	}
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
