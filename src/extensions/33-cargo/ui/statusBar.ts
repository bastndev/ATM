import * as vscode from 'vscode';
import { RunnerPhase, RunnerState } from '../host/runner';

/**
 * The Cargo Run item in the status bar. It shows up only while there is
 * something to say (building, running, failed) and hides when idle; the ▶
 * in the editor title is the way to start. A click does what Alt+G does:
 * stop when something runs, run again otherwise.
 */

const TOGGLE = 'atm.cargo.toggle';
const RESTART = 'atm.cargo.restart';
const STOP = 'atm.cargo.stop';
const CANCEL_BUILD = 'atm.cargo.cancelBuild';
const SHOW_OUTPUT = 'atm.cargo.showOutput';

interface Look {
	icon: string;
	background?: string;
	summary: (state: RunnerState) => string;
}

const LOOKS: Record<Exclude<RunnerPhase, 'idle'>, Look> = {
	building: {
		icon: 'sync~spin',
		summary: (state) =>
			state.programRunning
				? vscode.l10n.t('Building… The program keeps running until the new build is ready.')
				: vscode.l10n.t('Building…'),
	},
	running: { icon: 'debug-stop', summary: () => vscode.l10n.t('Running.') },
	stale: {
		icon: 'warning',
		background: 'statusBarItem.warningBackground',
		summary: () => vscode.l10n.t('The build failed, so the program from the previous build is still running.'),
	},
	failed: { icon: 'error', background: 'statusBarItem.errorBackground', summary: () => vscode.l10n.t('The build failed.') },
	crashed: {
		icon: 'error',
		background: 'statusBarItem.errorBackground',
		summary: (state) =>
			state.signal
				? vscode.l10n.t('The program was stopped by {0}.', state.signal)
				: vscode.l10n.t('The program exited with code {0}.', String(state.exitCode ?? '?')),
	},
};

export class CargoStatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem('atm.cargo.status', vscode.StatusBarAlignment.Left, 39);

	constructor() {
		this.item.name = vscode.l10n.t('ATM Cargo Run');
		this.item.command = TOGGLE;
	}

	render(state: RunnerState): void {
		if (state.phase === 'idle' || !state.label) {
			this.item.hide();
			return;
		}
		const look = LOOKS[state.phase];
		this.item.text = `$(${look.icon}) ${state.label}`;
		this.item.backgroundColor = look.background ? new vscode.ThemeColor(look.background) : undefined;
		this.item.tooltip = tooltip(state, look.summary(state));
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}

function tooltip(state: RunnerState, summary: string): vscode.MarkdownString {
	const active = state.phase === 'building' || state.phase === 'running' || state.phase === 'stale';
	const links = [
		state.phase === 'building'
			? `[$(close) ${vscode.l10n.t('Cancel build')}](command:${CANCEL_BUILD})`
			: `[$(debug-restart) ${vscode.l10n.t('Restart')}](command:${RESTART} "Ctrl+G")`,
		active ? `[$(debug-stop) ${vscode.l10n.t('Stop')}](command:${STOP} "Alt+G")` : undefined,
		`[$(terminal) ${vscode.l10n.t('Output')}](command:${SHOW_OUTPUT})`,
	].filter((link) => link !== undefined);
	const markdown = new vscode.MarkdownString(`**Cargo Run** · \`${state.label}\`\n\n${summary}\n\n${links.join(' · ')}`, true);
	markdown.isTrusted = { enabledCommands: [RESTART, STOP, CANCEL_BUILD, SHOW_OUTPUT] };
	return markdown;
}
