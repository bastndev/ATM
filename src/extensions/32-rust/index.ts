import * as vscode from 'vscode';
import { EditorProjectFiles } from './host/projectFiles';
import { BasicTypeHintsProvider } from './providers/basicHints';
import { RustColorProvider } from './providers/colorPicker';
import { CARGO_TASK_TYPE, CargoTaskProvider } from './providers/cargoTasks';
import { MutUnderline } from './providers/mutUnderline';
import { RunLensProvider } from './providers/runLens';
import { RustfmtFormatter } from './providers/rustfmt';
import { RustTokenCache } from './providers/tokenCache';
import { registerRustCommands } from './ui/commands';

/** The official rust-analyzer extension. When it is installed, ATM's Rust support stays off. */
export const OFFICIAL_RUST_EXTENSION = 'rust-lang.rust-analyzer';

const RUST: vscode.DocumentSelector = { language: 'rust', scheme: 'file' };
const SECTION = 'atm.rust';

/**
 * Rust support written in ATM itself: type hints for values whose type is
 * obvious, the `mut` underline, ▶ Run / Run Test buttons, rustfmt, Cargo
 * tasks and a colour picker for egui, gpui, iced, Bevy and other GUI
 * libraries. It reads only the open file and its Cargo.toml, never indexes the
 * project and starts no background program, so it stays light on any
 * machine.
 */
export function activateRust(context: vscode.ExtensionContext): void {
	context.subscriptions.push(new RustController());
}

class RustController implements vscode.Disposable {
	private readonly tokens = new RustTokenCache();
	private readonly files = new EditorProjectFiles();
	private readonly disposables: vscode.Disposable[];
	private features: vscode.Disposable[] = [];
	/** Settings the current features were built for, to skip rebuilding when nothing changed. */
	private builtFor: string | undefined;

	constructor() {
		this.disposables = [
			this.tokens,
			...registerRustCommands(),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(SECTION)) {
					this.update();
				}
			}),
			vscode.workspace.onDidGrantWorkspaceTrust(() => this.update()),
			vscode.extensions.onDidChange(() => this.update()),
		];
		this.update();
	}

	/** Turns the features on or off to match the settings, workspace trust and installed extensions. */
	private update(): void {
		const config = vscode.workspace.getConfiguration(SECTION);
		const enabled = config.get<boolean>('enabled', true);
		const active = enabled && !vscode.extensions.getExtension(OFFICIAL_RUST_EXTENSION);
		const state = {
			active,
			// rust-analyzer has no colour picker, so this one stays on next to the official extension.
			colorPicker: enabled && config.get<boolean>('colorPicker', true),
			typeHints: active && config.get<boolean>('inlayHints.typeHints', true),
			runButtons: active && config.get<boolean>('runButtons', true),
			// rustfmt and cargo may run code from the project (rust-toolchain.toml, build.rs).
			trusted: active && vscode.workspace.isTrusted,
		};
		const key = JSON.stringify(state);
		if (key === this.builtFor) {
			return;
		}
		this.builtFor = key;
		this.disposeFeatures();
		if (state.colorPicker) {
			this.features.push(vscode.languages.registerColorProvider(RUST, new RustColorProvider(this.tokens)));
		}
		if (!state.active) {
			return;
		}

		this.features.push(new MutUnderline(this.tokens));
		if (state.typeHints) {
			this.features.push(vscode.languages.registerInlayHintsProvider(RUST, new BasicTypeHintsProvider(this.tokens)));
		}
		if (state.trusted) {
			this.features.push(
				vscode.languages.registerDocumentFormattingEditProvider(RUST, new RustfmtFormatter()),
				vscode.tasks.registerTaskProvider(CARGO_TASK_TYPE, new CargoTaskProvider()),
			);
			if (state.runButtons) {
				const runLens = new RunLensProvider(this.tokens, this.files);
				this.features.push(runLens, vscode.languages.registerCodeLensProvider(RUST, runLens));
			}
		}
	}

	private disposeFeatures(): void {
		this.features.forEach((feature) => feature.dispose());
		this.features = [];
	}

	dispose(): void {
		this.disposeFeatures();
		this.disposables.forEach((disposable) => disposable.dispose());
	}
}
