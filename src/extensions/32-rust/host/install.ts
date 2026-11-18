import * as vscode from 'vscode';
import { findTool, installRustAnalyzer } from './toolchain';

const DONT_ASK_KEY = 'atm.rust.installPrompt.dismissed';

/**
 * Offers to install the rust-analyzer program with rustup when it is
 * missing. It asks once per session at most, installs only after a click,
 * and never installs or opens an extension.
 */
export class InstallPrompt {
	private askedThisSession = false;
	private installing: Promise<boolean> | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
	) {}

	/** Shows the notification if rustup can install rust-analyzer. Resolves true once it is installed. */
	async offer(cwd: string | undefined): Promise<boolean> {
		if (this.askedThisSession || this.installing || this.context.globalState.get<boolean>(DONT_ASK_KEY)) {
			return false;
		}
		const rustup = await findTool('rustup', cwd);
		if (!rustup) {
			return false;
		}
		this.askedThisSession = true;

		const install = vscode.l10n.t('Install');
		const notNow = vscode.l10n.t('Not now');
		const never = vscode.l10n.t("Don't ask again");
		const choice = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				'ATM Rust: autocomplete, exact types and Run buttons need the rust-analyzer program (part of Rust, not an extension). Install it now?',
			),
			install,
			notNow,
			never,
		);
		if (choice === never) {
			await this.context.globalState.update(DONT_ASK_KEY, true);
			return false;
		}
		return choice === install ? this.install(cwd) : false;
	}

	/** Runs `rustup component add rust-analyzer` with a progress notification. */
	install(cwd: string | undefined): Promise<boolean> {
		if (!this.installing) {
			this.installing = this.runInstall(cwd).finally(() => {
				this.installing = undefined;
			});
		}
		return this.installing;
	}

	private async runInstall(cwd: string | undefined): Promise<boolean> {
		const rustup = await findTool('rustup', cwd);
		if (!rustup) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('ATM Rust: rustup was not found. Install rust-analyzer with the tool you used to install Rust, then run "ATM Rust: Restart rust-analyzer".'),
			);
			return false;
		}
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('ATM Rust: installing rust-analyzer…') },
			() => installRustAnalyzer(rustup, cwd),
		);
		this.output.appendLine(`$ rustup component add rust-analyzer\n${result.output}`);
		const installed = result.ok && (await findTool('rust-analyzer', cwd)) !== undefined;
		if (installed) {
			vscode.window.setStatusBarMessage(vscode.l10n.t('$(check) rust-analyzer installed'), 4000);
		} else {
			const showLog = vscode.l10n.t('Show log');
			const choice = await vscode.window.showErrorMessage(vscode.l10n.t('ATM Rust: rust-analyzer could not be installed.'), showLog);
			if (choice === showLog) {
				this.output.show(true);
			}
		}
		return installed;
	}
}
