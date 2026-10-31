/**
 * @module ai-data-id
 * Entry point for the Antigravity AI Data status bar monitor.
 * Supports both standalone Antigravity IDE and parallel Antigravity 2.0 / `agy` CLI setups.
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */

import * as vscode from 'vscode';
import { ProcessFinder } from './core/process-finder';
import { QuotaManager } from './core/quota-manager';
import { QuotaSnapshot } from './core/types';
import { buildTooltip, computeEngineeredTokens, resolvePlanTier } from './ui/tooltip-builder';

// ── Constants ────────────────────────────────────────────────────────

/** How often (ms) to poll — all key models healthy. */
const POLLING_INTERVAL_NORMAL_MS    = 60_000;       // 1 minute
/** How often (ms) to poll — any key model (Pro / Claude / GPT-OSS) at ≤ 20%. */
const POLLING_INTERVAL_ALERT_MS     = 15_000;       // 15 seconds
/** How often (ms) to poll — global quota ≤ 20% (exhausted, nothing left to watch). */
const POLLING_INTERVAL_EXHAUSTED_MS = 30 * 60_000;  // 30 minutes

/** Delay (ms) before the first fetch to avoid blocking IDE startup. */
const INITIAL_DELAY_MS = 3_000;

// ── Status bar icons ─────────────────────────────────────────────────

const ICON_DEFAULT = '$(sparkle-filled)';
const ICON_ERROR = '$(error)';
const ICON_WARNING = '$(warning)';
const ICON_REFRESH = '$(sync~spin)';

// ── Polling tier ─────────────────────────────────────────────────────

type PollingTier = 'normal' | 'alert' | 'exhausted';

/**
 * Keywords identifying "key" models for quota monitoring.
 * Excludes Flash/fast models — they have much larger allocations and
 * rarely determine whether real coding work is possible.
 */
const KEY_MODEL_KEYWORDS = [
	'pro',
	'ultra',
	'argon',
	'gemini models',
	'claude',
	'sonnet',
	'opus',
	'gpt-oss',
	'gpt',
	'llama',
	'deepseek',
];

/**
 * Resolves the adaptive polling tier from the latest snapshot.
 *
 * Priority (highest first):
 *   - `exhausted` → global ≤ 20%: most tokens gone, poll every 30 min.
 *   - `alert`     → any key model ≤ 20% or exhausted: poll every 15 s.
 *   - `normal`    → everything healthy: poll every 60 s.
 *
 * Key models = PRO basket (Gemini Pro / Argon) + THIRD_PARTY basket (Claude, GPT-OSS).
 * Gemini Flash is intentionally excluded from alert triggering.
 */
function resolvePollingTier(snapshot: QuotaSnapshot, globalPct: number): PollingTier {
	if (globalPct <= 20) { return 'exhausted'; }

	const inDanger = snapshot.models.some(m => {
		const idOrLabel = (m.modelId + ' ' + m.label).toLowerCase();
		if (!KEY_MODEL_KEYWORDS.some(kw => idOrLabel.includes(kw))) { return false; }
		return m.isExhausted || (m.remainingPercentage !== undefined && m.remainingPercentage <= 20);
	});

	return inDanger ? 'alert' : 'normal';
}

/**
 * Checks whether the current host IDE or environment is explicitly Antigravity.
 */
function detectAntigravityHost(): boolean {
	const appName = (vscode.env.appName || '').toLowerCase();
	const uriScheme = (vscode.env.uriScheme || '').toLowerCase();
	if (
		appName.includes('antigravity')
		|| appName.includes('agy')
		|| uriScheme.includes('antigravity')
		|| uriScheme.includes('agy')
	) {
		return true;
	}
	return Boolean(
		process.env.ANTIGRAVITY_CLI_PATH
		|| process.env.ANTIGRAVITY_AGENT
		|| process.env.AGY_ACCOUNT,
	);
}

/**
 * Activates the AI Data status bar extension.
 * Runs immediately when the host IDE is Antigravity, and also auto-discovers
 * Antigravity 2.0 / `agy` background processes when running in sibling editors.
 *
 * @param context - VS Code extension context for lifecycle management.
 */
export function activateDataId(context: vscode.ExtensionContext): void {
	let isAntigravity = detectAntigravityHost();
	let isStatusBarVisible = isAntigravity;

	void vscode.commands.executeCommand('setContext', 'atm.isAntigravity', isAntigravity);

	// ── Status bar item ──────────────────────────────────────────────

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = `| ${ICON_DEFAULT} AI Data`;
	statusBarItem.command = 'atm.dataId.showConsumption';
	statusBarItem.tooltip = new vscode.MarkdownString('*Loading AI usage data...*');
	if (isStatusBarVisible) {
		statusBarItem.show();
	}

	// ── Core services ────────────────────────────────────────────────

	const processFinder = new ProcessFinder();
	const quotaManager = new QuotaManager();

	// ── Fetch state ──────────────────────────────────────────────────

	let isFetching = false;
	let queuedForceRefresh = false;
	let lastSnapshotHash = '';
	let lastSnapshot: QuotaSnapshot | null = null;
	let fetchTimer: NodeJS.Timeout | null = null;
	let lastReportedPercentage = 100; // Stores the last engineered percentage

	/** Ensures the status bar item and context key are enabled once Antigravity is detected. */
	function ensureStatusBarVisible(): void {
		if (!isAntigravity) {
			isAntigravity = true;
			void vscode.commands.executeCommand('setContext', 'atm.isAntigravity', true);
		}
		if (!isStatusBarVisible) {
			isStatusBarVisible = true;
			statusBarItem.show();
		}
	}

	/** Builds a hash of the snapshot to detect meaningful changes. */
	function computeSnapshotHash(snapshot: QuotaSnapshot): string {
		return snapshot.models
			.map(m => `${m.modelId}:${m.remainingPercentage}:${m.isExhausted}:${m.resetTime.getTime()}`)
			.join('|');
	}

	/**
	 * Fetches quota data and updates the status bar item.
	 * Handles connection initialization, hash-based deduplication,
	 * and schedules the next poll.
	 */
	async function fetchAndUpdateQuota(forceRefresh = false): Promise<boolean> {
		if (isFetching) {
			if (forceRefresh) {
				queuedForceRefresh = true;
			}
			return false;
		}
		isFetching = true;

		try {
			const connectionInfo = quotaManager.getConnectionInfo();

			// If not connected yet, detect the Antigravity process
			if (!connectionInfo) {
				const retries = isAntigravity || forceRefresh ? undefined : 1;
				const processInfo = await processFinder.detectProcessInfo(retries);
				if (processInfo) {
					ensureStatusBarVisible();
					quotaManager.init(processInfo.connectPort, processInfo.csrfToken);
					quotaManager.init(processInfo.connectPort, processInfo.csrfToken, processInfo.protocol);
					statusBarItem.text = `| ${ICON_DEFAULT} AI Data`;
					statusBarItem.color = undefined;
				} else {
					if (isAntigravity || forceRefresh) {
						ensureStatusBarVisible();
						statusBarItem.text = `| ${ICON_ERROR} AI Data`;
						statusBarItem.color = new vscode.ThemeColor('errorForeground');
						statusBarItem.tooltip = new vscode.MarkdownString(
							'Could not connect to the local Antigravity AI process.'
						);
					}
					return false;
				}
			}

			// Fetch quota data via local HTTPS
			const snapshot = await quotaManager.fetchQuota();
			if (snapshot) {
				const currentHash = computeSnapshotHash(snapshot);

				if (currentHash !== lastSnapshotHash || forceRefresh) {
					lastSnapshot = snapshot;
					statusBarItem.tooltip = buildTooltip(snapshot);
					lastSnapshotHash = currentHash;
				}

				const measuredModels = snapshot.models.filter(m => m.remainingPercentage !== undefined);
				if (measuredModels.length === 0) {
					statusBarItem.text = `| ${ICON_DEFAULT} AI Data`;
					statusBarItem.color = undefined;
				} else {
					// Use the new, robust global engineered algorithm!
					const tier = resolvePlanTier(snapshot.teamsTier, snapshot.planName);
					const engineered = computeEngineeredTokens(snapshot.models, tier);
					
					if (engineered.type === 'unlimited') {
						statusBarItem.text = `| ✨ AI ∞%`;
						statusBarItem.color = undefined;
						lastReportedPercentage = 100;
					} else {
						const globalPct = Math.round(engineered.percentage);
						lastReportedPercentage = globalPct;
						// low quota renders plain (like the ATM item next to it) — no warning icon/yellow
						statusBarItem.text = `| ${ICON_DEFAULT} AI ${globalPct}%`;
						if (globalPct === 0) {
							statusBarItem.color = new vscode.ThemeColor('disabledForeground');
						} else {
							statusBarItem.color = undefined;
						}
					}
				}
			}

			return true;
		} catch (e) {
			console.error('[ai-data-id] Error fetching quota:', e);
			quotaManager.reset();
			statusBarItem.text = `| ${ICON_WARNING} AI Data`;
			statusBarItem.color = new vscode.ThemeColor('errorForeground');
			statusBarItem.tooltip = new vscode.MarkdownString(
				'Partial connection error. Will retry automatically...'
			);
			return false;
		} finally {
			isFetching = false;
			if (fetchTimer) { clearTimeout(fetchTimer); }

			if (queuedForceRefresh) {
				queuedForceRefresh = false;
				fetchTimer = setTimeout(() => {
					void fetchAndUpdateQuota(true);
				}, 0);
			} else {
				// Adaptive 3-Tier Polling:
				// Only schedule if the window is focused and Antigravity is active (performance optimization).
				if (vscode.window.state.focused && isAntigravity) {
					const tier = lastSnapshot
						? resolvePollingTier(lastSnapshot, lastReportedPercentage)
						: 'normal';
					const nextInterval =
						tier === 'exhausted' ? POLLING_INTERVAL_EXHAUSTED_MS :
						tier === 'alert'     ? POLLING_INTERVAL_ALERT_MS :
						POLLING_INTERVAL_NORMAL_MS;
					fetchTimer = setTimeout(() => {
						void fetchAndUpdateQuota();
					}, nextInterval);
				}
			}
		}
	}

	/** Triggers an immediate refresh with visual feedback. */
	const forceRefresh = async (): Promise<void> => {
		statusBarItem.text = `| ${ICON_REFRESH} AI Data`;
		if (lastSnapshot && !isFetching) {
			statusBarItem.tooltip = buildTooltip(lastSnapshot, true);
		}
		await fetchAndUpdateQuota(true);
	};

	// ── Commands ─────────────────────────────────────────────────────

	const refreshCmd = vscode.commands.registerCommand('atm.dataId.refreshConsumption', forceRefresh);
	const showCmd = vscode.commands.registerCommand('atm.dataId.showConsumption', forceRefresh);

	// ── Event Listeners (Impact & Focus) ─────────────────────────────

	// 1. Smart Wake-up (Focus)
	const windowStateSub = vscode.window.onDidChangeWindowState((state) => {
		if (state.focused) {
			// Update immediately when returning to VS Code
			void fetchAndUpdateQuota();
		} else {
			// Pause polling to save resources while in background
			if (fetchTimer)    { clearTimeout(fetchTimer);   fetchTimer    = null; }
			if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
		}
	});

	// 2. Impact Detector (Large code insertions / AI activity)
	let debounceTimer: NodeJS.Timeout | null = null;
	const textDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
		if (e.document.uri.scheme !== 'file') { return; }

		// Ignore changes in build outputs, dependencies and VCS internals
		const filePath = e.document.uri.fsPath;
		if (/[/\\](?:node_modules|dist|build|out|\.git)[/\\]/.test(filePath)) { return; }

		const hasLargeInsert = e.contentChanges.some(change => {
			const text = change.text;
			if (!text) { return false; }
			const lineCount = (text.match(/\n/g) || []).length;
			return lineCount >= 3;
		});

		if (hasLargeInsert) {
			if (debounceTimer) { clearTimeout(debounceTimer); }
			// 5s debounce to avoid spamming the local server
			debounceTimer = setTimeout(() => {
				void fetchAndUpdateQuota();
			}, 5000);
		}
	});

	// ── Bootstrap ────────────────────────────────────────────────────

	fetchTimer = setTimeout(() => fetchAndUpdateQuota(), INITIAL_DELAY_MS);

	// ── Cleanup ──────────────────────────────────────────────────────

	context.subscriptions.push(
		statusBarItem,
		refreshCmd,
		showCmd,
		windowStateSub,
		textDocSub,
		{
			dispose: () => {
				if (fetchTimer) { clearTimeout(fetchTimer); }
				if (debounceTimer) { clearTimeout(debounceTimer); }
				quotaManager.dispose();
			}
		}
	);
}
