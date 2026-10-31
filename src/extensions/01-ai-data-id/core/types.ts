/**
 * @module types
 * Pure data contracts for the AI Data extension.
 * Separated into two layers:
 *   - **Client types**: used internally across the extension (`ModelQuotaInfo`, `QuotaSnapshot`, etc.)
 *   - **Server types**: mirror the raw JSON shape from the Antigravity language server API
 *     (supports both legacy `GetUserStatus` and Antigravity 2.0 `RetrieveUserQuotaSummary`)
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */

// ── Client-side types ────────────────────────────────────────────────

/** Quota information for a single AI model or quota bucket, already normalized. */
export interface ModelQuotaInfo {
	/** Human-readable model name (e.g. "Gemini 3.8 Pro (High)" or "Gemini Models (5h)") */
	label: string;
	/** Machine-readable model or bucket identifier */
	modelId: string;
	/** Optional quota window type when sourced from bucket summary (e.g. "5h", "weekly") */
	window?: string;
	/** Remaining quota as a fraction [0, 1]. `undefined` = unlimited. */
	remainingFraction?: number;
	/** Remaining quota as a percentage [0, 100]. `undefined` = unlimited. */
	remainingPercentage?: number;
	/** Whether the model has reached 0% quota */
	isExhausted: boolean;
	/** Absolute time when the quota resets */
	resetTime: Date;
	/** Milliseconds until the quota resets */
	timeUntilReset: number;
	/** Human-readable time until reset (e.g. "2h 30m") */
	timeUntilResetFormatted: string;
}

/** Prompt token information for the user's plan. */
export interface PromptTokensInfo {
	/** Tokens currently available */
	available: number;
	/** Total monthly token allowance */
	monthly: number;
	/** Percentage of tokens consumed [0, 100] */
	usedPercentage: number;
	/** Percentage of tokens remaining [0, 100] */
	remainingPercentage: number;
}

/** A point-in-time snapshot of all quota data. */
export interface QuotaSnapshot {
	/** When the snapshot was captured */
	timestamp: Date;
	/** Prompt token info, if available in the plan */
	promptTokens?: PromptTokensInfo;
	/** User's current plan name as returned by the server (e.g. "Google AI Pro") */
	planName?: string;
	/** Raw teams tier string from planInfo (e.g. "CONSUMER", "PRO", "ULTRA") */
	teamsTier?: string;
	/** Per-model quota information */
	models: ModelQuotaInfo[];
}

// ── Server-side types (raw API shapes) ───────────────────────────────

/** Raw quota info as returned by the language server. */
export interface ServerModelQuotaInfo {
	remainingFraction?: number;
	resetTime?: string;
}

/** Raw model/alias reference from the server. */
export interface ServerModelOrAlias {
	model?: string;
}

/** Raw client model config from the server. */
export interface ServerClientModelConfig {
	label?: string;
	modelOrAlias?: ServerModelOrAlias;
	quotaInfo?: ServerModelQuotaInfo;
}

/** Full server response shape for the GetUserStatus endpoint. */
export interface ServerUserStatusResponse {
	userStatus: {
		name: string;
		email: string;
		planStatus?: {
			planInfo: {
				teamsTier: string;
				planName: string;
				monthlyPromptTokens?: number;
				monthlyFlowTokens?: number;
				monthlyPromptCredits?: number;
				monthlyFlowCredits?: number;
			};
			availablePromptTokens?: number;
			availableFlowTokens?: number;
			availablePromptCredits?: number;
			availableFlowCredits?: number;
		};
		userTier?: {
			id?: string;
			name?: string;
		};
		cascadeModelConfigData?: {
			clientModelConfigs: ServerClientModelConfig[];
		};
	};
}

/** Raw quota bucket from the Antigravity 2.0 RetrieveUserQuotaSummary endpoint. */
export interface ServerQuotaBucket {
	bucketId?: string;
	displayName?: string;
	window?: string;
	remainingFraction?: number;
	resetTime?: string;
}

/** Raw model-family quota group from the Antigravity 2.0 RetrieveUserQuotaSummary endpoint. */
export interface ServerQuotaGroup {
	displayName?: string;
	buckets?: ServerQuotaBucket[];
}

/** Full server response shape for the RetrieveUserQuotaSummary endpoint. */
export interface ServerQuotaSummaryResponse {
	response?: {
		groups?: ServerQuotaGroup[];
		planName?: string;
		teamsTier?: string;
	};
	groups?: ServerQuotaGroup[];
	planName?: string;
	teamsTier?: string;
}

// ── Shared utility types ─────────────────────────────────────────────

/** Information needed to connect to the local Antigravity process. */
export interface ProcessInfo {
	/** HTTP/HTTPS port the language server is listening on */
	connectPort: number;
	/** CSRF token extracted from the process command line */
	csrfToken: string;
	/** Protocol verified during port probing ('http' or 'https') */
	protocol?: 'http' | 'https';
}
