import * as http from 'http';
import * as https from 'https';
import {
	QuotaSnapshot,
	ServerUserStatusResponse,
	ServerQuotaSummaryResponse,
	ModelQuotaInfo,
	PromptTokensInfo,
	ServerClientModelConfig,
} from './types';

// ── Constants ────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for a quota API response. */
const QUOTA_REQUEST_TIMEOUT_MS = 5_000;

/** Endpoint path for the legacy/detailed GetUserStatus RPC. */
const USER_STATUS_ENDPOINT = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

/** Endpoint path for the Antigravity 2.0 RetrieveUserQuotaSummary RPC. */
const QUOTA_SUMMARY_ENDPOINT = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

/** Minimum value for a quota fraction (clamped). */
const FRACTION_MIN = 0;
/** Maximum value for a quota fraction (clamped). */
const FRACTION_MAX = 1;

/** Minimum value for a percentage (clamped). */
const PERCENTAGE_MIN = 0;
/** Maximum value for a percentage (clamped). */
const PERCENTAGE_MAX = 100;

// ── Time formatting thresholds ───────────────────────────────────────

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * Manages the connection to the local Antigravity language server
 * and fetches AI model quota/usage data via its HTTPS API.
 *
 * Supports a dual-endpoint fallback chain:
 *   1. `GetUserStatus` (per-model configs + plan metadata)
 *   2. `RetrieveUserQuotaSummary` (Antigravity 2.0 multi-group 5h & weekly buckets)
 *
 * Lifecycle:
 *   1. Call `init()` with a port and CSRF token (obtained from `ProcessFinder`)
 *   2. Call `fetchQuota()` periodically to get usage snapshots
 *   3. Call `reset()` on connection errors (triggers re-detection)
 *   4. Call `dispose()` when the extension is deactivated
 *
 * **Security note**: `rejectUnauthorized: false` is intentional.
 * The language server runs on `127.0.0.1` with a self-signed certificate.
 * Authentication is handled by the CSRF token, not TLS certificate validation.
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */
export class QuotaManager {
	private port: number = 0;
	private csrfToken: string = '';
	private protocol: 'http' | 'https' = 'https';
	private sharedHttpsAgent: https.Agent | null = null;
	private sharedHttpAgent: http.Agent | null = null;

	private getHttpsAgent(): https.Agent {
		if (!this.sharedHttpsAgent) {
			this.sharedHttpsAgent = new https.Agent({ keepAlive: true });
		}
		return this.sharedHttpsAgent;
	}

	private getHttpAgent(): http.Agent {
		if (!this.sharedHttpAgent) {
			this.sharedHttpAgent = new http.Agent({ keepAlive: true });
		}
		return this.sharedHttpAgent;
	}

	/** Initialize the connection parameters. Must be called before `fetchQuota()`. */
	init(port: number, csrfToken: string, protocol: 'http' | 'https' = 'https'): void {
		this.port = port;
		this.csrfToken = csrfToken;
		this.protocol = protocol;
	}

	/** Reset the connection, forcing a fresh process detection on next fetch. */
	reset(): void {
		this.port = 0;
		this.csrfToken = '';
		if (this.sharedHttpsAgent) {
			this.sharedHttpsAgent.destroy();
			this.sharedHttpsAgent = null;
		}
		if (this.sharedHttpAgent) {
			this.sharedHttpAgent.destroy();
			this.sharedHttpAgent = null;
		}
	}

	/** Clean up the shared HTTP/HTTPS agents. Call on extension deactivation. */
	dispose(): void {
		this.reset();
	}

	/** Whether the manager has valid connection parameters. */
	isConnected(): boolean {
		return this.port !== 0;
	}

	/** Returns current connection info, or `null` if not connected. */
	getConnectionInfo(): { connectPort: number; csrfToken: string; protocol: 'http' | 'https' } | null {
		if (!this.isConnected()) { return null; }
		return { connectPort: this.port, csrfToken: this.csrfToken, protocol: this.protocol };
	}

	/**
	 * Fetches a fresh quota snapshot from the language server.
	 * Queries `GetUserStatus` and automatically falls back to or merges with
	 * `RetrieveUserQuotaSummary` for Antigravity 2.0 compatibility.
	 *
	 * @throws {Error} If the connection is not initialized or all endpoints fail.
	 */
	async fetchQuota(): Promise<QuotaSnapshot | null> {
		if (!this.isConnected()) {
			throw new Error('Connection not initialized. Call init() first.');
		}

		let statusSnapshot: QuotaSnapshot | null = null;
		let statusError: unknown = null;

		try {
			const rawStatus = await this.postRpc<ServerUserStatusResponse>(USER_STATUS_ENDPOINT);
			statusSnapshot = this.parseResponse(rawStatus);
			if (statusSnapshot.models.length > 0) {
				return statusSnapshot;
			}
		} catch (err) {
			statusError = err;
		}

		try {
			const rawSummary = await this.postRpc<ServerQuotaSummaryResponse>(QUOTA_SUMMARY_ENDPOINT);
			return this.parseQuotaSummaryResponse(rawSummary, statusSnapshot ?? undefined);
		} catch (summaryError) {
			if (statusSnapshot) {
				return statusSnapshot;
			}
			throw statusError ?? summaryError;
		}
	}

	/**
	 * Executes a POST Connect-RPC request against the local Antigravity HTTP/HTTPS server.
	 */
	private postRpc<T>(endpoint: string): Promise<T> {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify({
				metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' },
			});

			const isHttps = this.protocol === 'https';
			const requestFn = isHttps ? https.request : http.request;

			const req = requestFn({
				hostname: '127.0.0.1',
				port: this.port,
				path: endpoint,
				method: 'POST',
				agent: isHttps ? this.getHttpsAgent() : this.getHttpAgent(),
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data),
					'Connect-Protocol-Version': '1',
					'X-Codeium-Csrf-Token': this.csrfToken,
					'X-CSRF-Token': this.csrfToken,
				},
				...(isHttps ? { rejectUnauthorized: false } : {}),
				timeout: QUOTA_REQUEST_TIMEOUT_MS,
			}, res => {
				let body = '';
				res.on('data', chunk => body += chunk);
				res.on('end', () => {
					if (res.statusCode !== 200) {
						reject(new Error(`Unexpected status ${res.statusCode} from ${endpoint}: ${body.slice(0, 200)}`));
						return;
					}
					if (!body.trim()) {
						reject(new Error(`Empty response body from ${endpoint}`));
						return;
					}
					try {
						const json = JSON.parse(body) as T;
						resolve(json);
					} catch (e) {
						reject(e);
					}
				});
			});
			req.on('error', reject);
			req.on('timeout', () => { req.destroy(); reject(new Error('Request Timeout')); });
			req.write(data);
			req.end();
		});
	}

	// ── Response parsing ─────────────────────────────────────────────

	/**
	 * Parses a `GetUserStatus` response into a normalized `QuotaSnapshot`.
	 */
	public parseResponse(data: ServerUserStatusResponse): QuotaSnapshot {
		const { userStatus } = data;
		const planName = userStatus?.planStatus?.planInfo?.planName ?? userStatus?.userTier?.name;
		const teamsTier = userStatus?.planStatus?.planInfo?.teamsTier;
		if (!userStatus?.cascadeModelConfigData) {
			return {
				timestamp: new Date(),
				planName,
				teamsTier,
				promptTokens: this.parsePromptTokens(data),
				models: [],
			};
		}

		const rawModels: ServerClientModelConfig[] = userStatus.cascadeModelConfigData.clientModelConfigs || [];
		const allModels: ModelQuotaInfo[] = rawModels
			.filter(m => m.quotaInfo)
			.map(m => {
				const rawFraction = m.quotaInfo?.remainingFraction;
				const remainingFraction = this.normalizeFraction(rawFraction);

				const resetTime = m.quotaInfo?.resetTime ? new Date(m.quotaInfo.resetTime) : new Date();
				const diff = resetTime.getTime() - Date.now();

				// A model is exhausted if:
				// 1. Its remaining fraction is explicitly 0
				// 2. OR it has a reset time but NO remaining fraction (common for exhausted Claude/GPT-OSS models)
				const isExhausted = remainingFraction === 0 || (remainingFraction === undefined && m.quotaInfo?.resetTime !== undefined && diff > 0);

				return {
					label: m.label || 'Unknown model',
					modelId: m.modelOrAlias?.model || 'unknown',
					remainingFraction,
					remainingPercentage: remainingFraction !== undefined
						? remainingFraction * PERCENTAGE_MAX
						: undefined,
					isExhausted,
					resetTime,
					timeUntilReset: diff,
					timeUntilResetFormatted: QuotaManager.formatTime(diff),
				};
			});

		// Deduplicate redundant (Low)/(Medium) tiers when a (High) tier of the same model family
		// has the exact same quota fraction and reset timestamp (keeps tooltip compact in Antigravity 2.0)
		const highVariants = new Map<string, string>();
		for (const m of allModels) {
			if (m.label.endsWith('(High)')) {
				const baseName = m.label.replace(/\s*\(High\)$/, '');
				highVariants.set(baseName, `${m.remainingFraction}:${m.resetTime.getTime()}`);
			}
		}

		const models = allModels.filter(m => {
			const tierMatch = m.label.match(/^(.*?)\s*\((Low|Medium)\)$/);
			if (!tierMatch) { return true; }
			const baseName = tierMatch[1];
			const highSignature = highVariants.get(baseName);
			if (!highSignature) { return true; }
			return highSignature !== `${m.remainingFraction}:${m.resetTime.getTime()}`;
		});

		return {
			timestamp: new Date(),
			planName,
			teamsTier,
			promptTokens: this.parsePromptTokens(data),
			models,
		};
	}

	/**
	 * Parses an Antigravity 2.0 `RetrieveUserQuotaSummary` response into a normalized `QuotaSnapshot`.
	 * Maps multi-group quota buckets (e.g. 5h and weekly windows) into `ModelQuotaInfo` items.
	 */
	public parseQuotaSummaryResponse(
		data: ServerQuotaSummaryResponse,
		fallbackSnapshot?: Partial<QuotaSnapshot>,
	): QuotaSnapshot {
		const payload = data.response ?? data;
		const groups = payload.groups ?? [];
		const planName = payload.planName ?? fallbackSnapshot?.planName;
		const teamsTier = payload.teamsTier ?? fallbackSnapshot?.teamsTier;
		const models: ModelQuotaInfo[] = [];

		for (const group of groups) {
			const groupTitle = group.displayName || 'AI Models';
			const buckets = group.buckets ?? [];

			for (const bucket of buckets) {
				const rawFraction = bucket.remainingFraction;
				const remainingFraction = this.normalizeFraction(rawFraction);

				const resetTime = bucket.resetTime ? new Date(bucket.resetTime) : new Date();
				const diff = resetTime.getTime() - Date.now();

				const isExhausted = remainingFraction === 0
					|| (remainingFraction === undefined && bucket.resetTime !== undefined && diff > 0);

				const windowSuffix = bucket.window
					? ` (${bucket.window === 'weekly' ? 'Weekly' : bucket.window})`
					: bucket.displayName
						? ` (${bucket.displayName})`
						: '';

				models.push({
					label: `${groupTitle}${windowSuffix}`,
					modelId: bucket.bucketId || `${groupTitle.toLowerCase().replace(/\s+/g, '-')}-${bucket.window || 'quota'}`,
					window: bucket.window,
					remainingFraction,
					remainingPercentage: remainingFraction !== undefined
						? remainingFraction * PERCENTAGE_MAX
						: undefined,
					isExhausted,
					resetTime,
					timeUntilReset: diff,
					timeUntilResetFormatted: QuotaManager.formatTime(diff),
				});
			}
		}

		return {
			timestamp: new Date(),
			planName,
			teamsTier,
			promptTokens: fallbackSnapshot?.promptTokens,
			models,
		};
	}

	private parsePromptTokens(data: ServerUserStatusResponse): PromptTokensInfo | undefined {
		const planStatus = data.userStatus?.planStatus;
		if (!planStatus) { return undefined; }

		const monthly = planStatus.planInfo?.monthlyPromptTokens;
		const available = planStatus.availablePromptTokens;
		if (!Number.isFinite(monthly) || !Number.isFinite(available) || monthly <= 0) {
		const monthly = planStatus.planInfo?.monthlyPromptTokens ?? planStatus.planInfo?.monthlyPromptCredits;
		const available = planStatus.availablePromptTokens ?? planStatus.availablePromptCredits;
		if (monthly === undefined || available === undefined || !Number.isFinite(monthly) || !Number.isFinite(available) || monthly <= 0) {
			return undefined;
		}

		const usedPercentage = ((monthly - available) / monthly) * PERCENTAGE_MAX;
		const remainingPercentage = (available / monthly) * PERCENTAGE_MAX;

		return {
			available,
			monthly,
			usedPercentage: Math.min(Math.max(usedPercentage, PERCENTAGE_MIN), PERCENTAGE_MAX),
			remainingPercentage: Math.min(Math.max(remainingPercentage, PERCENTAGE_MIN), PERCENTAGE_MAX),
		};
	}

	// ── Pure utility methods (static for testability) ────────────────

	/**
	 * Clamps a raw fraction to the [0, 1] range.
	 * Returns `undefined` for non-finite or missing values (means "unlimited").
	 */
	private normalizeFraction(value: number | undefined): number | undefined {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return undefined;
		}
		return Math.min(Math.max(value, FRACTION_MIN), FRACTION_MAX);
	}

	/**
	 * Formats a duration in milliseconds into a human-readable string.
	 *
	 * @example
	 * formatTime(0)         // → "Ready"
	 * formatTime(300_000)   // → "5m"
	 * formatTime(5_400_000) // → "1h 30m"
	 * formatTime(90_000_000) // → "1d 1h"
	 */
	static formatTime(ms: number): string {
		if (ms <= 0) { return 'Ready'; }
		const mins = Math.ceil(ms / MS_PER_MINUTE);
		if (mins < MINUTES_PER_HOUR) { return `${mins}m`; }
		const hours = Math.floor(mins / MINUTES_PER_HOUR);
		if (hours >= HOURS_PER_DAY) {
			const days = Math.floor(hours / HOURS_PER_DAY);
			const remHours = hours % HOURS_PER_DAY;
			return `${days}d ${remHours}h`;
		}
		return `${hours}h ${mins % MINUTES_PER_HOUR}m`;
	}
}
