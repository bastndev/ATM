/**
 * @module tooltip-builder
 * Builds the rich Markdown tooltip and calculates engineered token metrics
 * for the Antigravity AI Data status bar item.
 *
 * Updated to support Antigravity 2.0 multi-group quota buckets (5h / Weekly)
 * and modern model families (Gemini 4 Argon, Gemini 3.8, Claude 3.7/4.6, GPT-OSS).
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */

import * as vscode from 'vscode';
import { QuotaSnapshot } from '../core/types';

// ── Constants ────────────────────────────────────────────────────────

const PROGRESS_BAR_SEGMENTS = 15;

const ALPHA_START = 255;
const ALPHA_END   = 90;

const UNFILLED_SEGMENT_COLOR = '#ffffff0f';

// ── Status colors ────────────────────────────────────────────────────

const COLOR_DANGER  = '#f43f5e';  // rose-500
const COLOR_WARNING = '#f59e0b';  // amber-500
const COLOR_INFO    = '#0ea5e9';  // sky-500
const COLOR_HEALTHY = '#10b981';  // emerald-500

// ── Text & UI colors ─────────────────────────────────────────────────

const COLOR_TEXT_PRIMARY   = '#f4f4f5';  // zinc-100
const COLOR_TEXT_SECONDARY = '#a1a1aa';  // zinc-400
const COLOR_SEPARATOR      = '#3f3f46';  // zinc-700

// ── Plan tier colors ─────────────────────────────────────────────────

const COLOR_PLAN_FREE  = '#a78bfa';  // violet-400
const COLOR_PLAN_PRO   = '#3b82f6';  // blue-500
const COLOR_PLAN_ULTRA = '#f59e0b';  // amber-500

// ── Model display order ──────────────────────────────────────────────

const MODEL_DISPLAY_ORDER: readonly string[] = [
	'Gemini 4 Argon (High)',
	'Gemini 4 Argon (Low)',
	'Gemini 3.8 Pro (High)',
	'Gemini 3.8 Pro (Low)',
	'Gemini 3.8 Flash (High)',
	'Gemini 3.8 Flash (Low)',
	'Gemini 3.5 Pro',
	'Gemini 3.5 Flash',
	'Gemini 3.1 Pro (High)',
	'Gemini 3.1 Pro (Low)',
	'Gemini 3 Flash',
	'Gemini Models (5h)',
	'Gemini Models (Weekly)',
	'Claude Sonnet 4.6 (Thinking)',
	'Claude Opus 4.6 (Thinking)',
	'Claude 3.7 Sonnet (Thinking)',
	'Claude 3.7 Sonnet',
	'Claude 3.5 Sonnet',
	'Claude and GPT models (5h)',
	'Claude and GPT models (Weekly)',
	'GPT-OSS 120B (Medium)',
];

// ── Separator ────────────────────────────────────────────────────────

const DIVIDER = `<span style="color:${COLOR_SEPARATOR};">─────────────────────────────────────────</span>\n\n`;

// ── Public API ───────────────────────────────────────────────────────

export function buildTooltip(snapshot: QuotaSnapshot, isRefreshing = false): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.isTrusted = true;
	md.supportHtml = true;
	md.supportThemeIcons = true;

	const peakWarning = isClaudePeakHour(snapshot.timestamp)
		? `${'&nbsp;'.repeat(23)}<span style="color:${COLOR_DANGER};">**Claude** ⏰</span>`
		: '';

	md.appendMarkdown(
		`### <span style="color:${COLOR_TEXT_PRIMARY}; font-weight:700;">Antigravity Quota</span>` +
		`<span style="color:${COLOR_SEPARATOR};"> · </span>` +
		`${buildPlanBadge(snapshot.teamsTier, snapshot.planName)}${peakWarning}\n\n`
	);
	md.appendMarkdown(`${buildTopSummary(snapshot)}\n\n`);
	md.appendMarkdown(DIVIDER);

	if (snapshot.models.length === 0) {
		md.appendMarkdown(`*$(sync~spin) <span style="color:${COLOR_TEXT_SECONDARY};">Waiting for quota data...</span>*\n`);
		return md;
	}

	for (const model of sortModelsByDisplayOrder(snapshot.models)) {
		md.appendMarkdown(buildModelRow(model));
	}

	md.appendMarkdown(DIVIDER);
	md.appendMarkdown(buildFooter(snapshot.timestamp, isRefreshing));

	return md;
}

// ── Plan tier ────────────────────────────────────────────────────────

/**
 * Resolves plan tier from the most reliable source available.
 * Priority: teamsTier → planName → FREE fallback.
 */
export function resolvePlanTier(teamsTier: string | undefined, planName: string | undefined): 'FREE' | 'PRO' | 'ULTRA' {
	if (teamsTier) {
		const t = teamsTier.toUpperCase();
		if (t.includes('ULTRA'))   { return 'ULTRA'; }
		if (/\bPRO\b/.test(t))     { return 'PRO'; }
		return 'FREE';
	}
	if (planName) {
		const p = planName.toLowerCase();
		if (p.includes('ultra'))   { return 'ULTRA'; }
		if (/\bpro\b/.test(p))     { return 'PRO'; }
	}
	return 'FREE';
}

function buildPlanBadge(teamsTier: string | undefined, planName: string | undefined): string {
	const tier  = resolvePlanTier(teamsTier, planName);
	const label = tier === 'ULTRA' ? 'Ultra' : tier === 'PRO' ? 'Pro' : 'Free';
	const color = tier === 'ULTRA' ? COLOR_PLAN_ULTRA : tier === 'PRO' ? COLOR_PLAN_PRO : COLOR_PLAN_FREE;
	return `<span style="color:${color};">AI (${label})</span>`;
}

// ── Engineered tokens ────────────────────────────────────────────────

export type EngineeredTokensResult =
	| { type: 'measured'; available: number; monthly: number; percentage: number }
	| { type: 'unlimited' };

/**
 * Core configuration for model categorization.
 * Maps keywords (found in modelId or label) to their respective "Baskets".
 */
const MODEL_BASKETS = {
	PRO: {
		keywords: ['pro', 'ultra', 'argon', 'gemini models'], // Gemini Pro / Ultra / Argon & bucket variants
		monthlyAllocation: 2000
	},
	FLASH: {
		keywords: ['flash', 'fast', 'haiku', 'lite'],
		monthlyAllocation: 1000
	},
	THIRD_PARTY: {
		keywords: ['claude', 'sonnet', 'opus', 'gpt-oss', 'gpt models', 'llama', 'deepseek'],
		monthlyAllocation: 2000                   // Claude + GPT-OSS share one pool
	}
};

/**
 * Computes a synthetic token score from model quotas.
 * FREE: 5 000 max · PRO: 50 000 max · ULTRA: unlimited.
 * Links connected models by treating them as aggregated "Baskets".
 */
export function computeEngineeredTokens(models: QuotaSnapshot['models'], tier: 'FREE' | 'PRO' | 'ULTRA'): EngineeredTokensResult {
	if (tier === 'ULTRA') { return { type: 'unlimited' }; }

	const tierMultiplier = tier === 'PRO' ? 10 : 1;
	
	// Track allocations dynamically
	let totalAvailable = 0;
	let totalMonthly = 0;

	// Process each basket
	for (const [, config] of Object.entries(MODEL_BASKETS)) {
		const monthlyForBasket = config.monthlyAllocation * tierMultiplier;

		// Find ALL models belonging to this basket
		const matchingModels = models.filter(m => {
			const idOrLabel = (m.modelId + ' ' + m.label).toLowerCase();
			return config.keywords.some(kw => idOrLabel.includes(kw));
		});

		// If the server returned no models for this basket, exclude it from the
		// calculation entirely — a missing basket is a server gap, not a 0% quota.
		// Counting it as 0 would produce false low-quota warnings.
		if (matchingModels.length === 0) { continue; }

		totalMonthly += monthlyForBasket;

		// Use the minimum remaining % across matching models (safest conservative estimate).
		// If any model is exhausted, the whole basket is treated as 0.
		let minPct = 100;
		let foundFinite = false;

		for (const m of matchingModels) {
			if (m.isExhausted) {
				minPct = 0;
				foundFinite = true;
				break; // One exhausted model drains the whole connected pool
			}
			if (m.remainingPercentage !== undefined) {
				minPct = Math.min(minPct, m.remainingPercentage);
				foundFinite = true;
			}
		}

		// foundFinite = false means all models in this basket are fully unlimited
		const basketAvailablePct = foundFinite ? minPct / 100 : 1.0;
		totalAvailable += (basketAvailablePct * monthlyForBasket);
	}

	const percentage = totalMonthly > 0 ? (totalAvailable / totalMonthly) * 100 : 0;

	return { 
		type: 'measured', 
		available: Math.ceil(totalAvailable), 
		monthly: totalMonthly, 
		percentage 
	};
}

// ── Tooltip sections ─────────────────────────────────────────────────

function buildTopSummary(snapshot: QuotaSnapshot): string {
	const measured     = snapshot.models.filter(m => m.remainingPercentage !== undefined || m.isExhausted);
	const totalMeasured = measured.length;
	const exhausted    = measured.filter(m => m.isExhausted).length;
	const critical     = measured.filter(m => (m.remainingPercentage ?? 100) < 15 && !m.isExhausted).length;

	const tier       = resolvePlanTier(snapshot.teamsTier, snapshot.planName);
	const engineered = computeEngineeredTokens(snapshot.models, tier);
	const parts: string[] = [];

	if (engineered.type === 'unlimited') {
		parts.push(
			`$(account) <span style="color:${COLOR_TEXT_SECONDARY};">Tokens:</span> <span style="color:${COLOR_PLAN_ULTRA};">**∞ Unlimited**</span>`,
			`$(pass) <span style="color:${COLOR_HEALTHY};">Ultra Access</span>`
		);
	} else {
		parts.push(
			`$(account) <span style="color:${COLOR_TEXT_SECONDARY};">Tokens:</span> <span style="color:${COLOR_TEXT_PRIMARY};">**${engineered.available}/${engineered.monthly}**</span>`,
			`$(pulse) <span style="color:${getStatusColor(Math.round(engineered.percentage))};">${Math.round(engineered.percentage)}% left</span>`
		);
	}

	if (totalMeasured === 0) {
		parts.push(`*<span style="color:${COLOR_TEXT_SECONDARY};">Discovering available models...</span>*`);
		return joinWithSeparator(parts);
	}

	const safeZone = Math.max(totalMeasured - exhausted - critical, 0);
	parts.push(
		`&ensp;$(heart) <span style="color:${COLOR_TEXT_SECONDARY};">Healthy:</span> <span style="color:${COLOR_HEALTHY};">**${safeZone}/${totalMeasured}**</span>`
	);

	return joinWithSeparator(parts);
}

/** Returns a small icon representing the model family. */
function getModelFamilyIcon(label: string): string {
	if (label.includes('Gemini')) { return '✦'; }
	if (label.includes('Claude')) { return '❋'; }
	if (label.includes('GPT'))    { return '▣'; }
	return '◇';
}

function buildModelRow(model: QuotaSnapshot['models'][number]): string {
	const safeLabel   = escapeInlineMarkdown(model.label);
	const isExhausted = model.isExhausted;
	const isUnlimited = model.remainingPercentage === undefined && !isExhausted;
	const icon        = getModelFamilyIcon(model.label);

	if (isExhausted) {
		const resetDate = model.resetTime.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' });
		const resetTime = model.resetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return (
			`<span style="color:${COLOR_TEXT_PRIMARY};">**${icon}&nbsp; ${safeLabel}**</span>  \n` +
			`<span style="color:${COLOR_DANGER};">**@gohitx**</span> &nbsp;&nbsp;` +
			`<span style="color:${COLOR_SEPARATOR};">|</span>&nbsp;&nbsp; ` +
			`$(history) <span style="color:${COLOR_TEXT_SECONDARY};">Refills on ${resetDate}, ${resetTime}</span>\n\n`
		);
	}

	if (isUnlimited) {
		return (
			`<span style="color:${COLOR_TEXT_PRIMARY};">**${icon}&nbsp; ${safeLabel}**</span>  \n` +
			`$(pass) <span style="color:${COLOR_TEXT_SECONDARY};">Included in plan • Unlimited</span>\n\n`
		);
	}

	const pct      = Math.round(model.remainingPercentage!);
	const pctColor = getModelStatusColor(model.label, pct);
	const bar      = generateModernBar(pct, pctColor);
	const padding  = '&ensp;'.repeat(Math.max(0, 3 - pct.toString().length));

	return (
		`<span style="color:${COLOR_TEXT_PRIMARY};">**${icon}&nbsp; ${safeLabel}**</span>  \n` +
		`${bar} &nbsp;&nbsp; <span style="color:${pctColor};">**${padding}${pct}%**</span> &nbsp;&nbsp;` +
		`<span style="color:${COLOR_SEPARATOR};">|</span>&nbsp;&nbsp; ` +
		`$(history) <span style="color:${COLOR_TEXT_SECONDARY};">${model.timeUntilResetFormatted}</span>\n\n`
	);
}

function buildFooter(timestamp: Date, isRefreshing: boolean): string {
	const icon = isRefreshing ? '$(sync~spin)' : '$(refresh)';
	const text = isRefreshing ? 'Refreshing...' : 'Refresh Usage';
	const link = isRefreshing
		? `<span style="color:${COLOR_TEXT_SECONDARY};">${icon} ${text}</span>`
		: `[${icon} ${text}](command:atm.dataId.refreshConsumption)`;

	return (
		`<span style="color:${COLOR_TEXT_SECONDARY};">Last update: ${formatTimestamp(timestamp)}</span>` +
		` &nbsp;&nbsp;<span style="color:${COLOR_SEPARATOR};">|</span>&nbsp;&nbsp; ${link}`
	);
}

// ── Utilities ────────────────────────────────────────────────────────

function isClaudePeakHour(date: Date): boolean {
	const day = date.getUTCDay();
	// no peak hours on weekends
	if (day === 0 || day === 6) { return false; }

	const hour = date.getUTCHours();
	// peak: 13:00–19:00 UTC (5–11 AM Pacific)
	return hour >= 13 && hour < 19;
}

function sortModelsByDisplayOrder(models: QuotaSnapshot['models']): QuotaSnapshot['models'] {
	return [...models].sort((a, b) => {
		const ai = MODEL_DISPLAY_ORDER.indexOf(a.label);
		const bi = MODEL_DISPLAY_ORDER.indexOf(b.label);
		if (ai !== -1 && bi !== -1) { return ai - bi; }
		if (ai !== -1) { return -1; }
		if (bi !== -1) { return  1; }
		return a.label.localeCompare(b.label);
	});
}

export function generateModernBar(pct: number, baseColor: string): string {
	const filled = Math.round((pct / 100) * PROGRESS_BAR_SEGMENTS);
	let bar = '';
	for (let i = 0; i < PROGRESS_BAR_SEGMENTS; i++) {
		if (i < filled) {
			const progress = filled > 1 ? i / (filled - 1) : 0;
			const alphaHex = Math.round(ALPHA_START - progress * (ALPHA_START - ALPHA_END))
				.toString(16).padStart(2, '0');
			bar += `<span style="color:${baseColor}${alphaHex};">●</span> `;
		} else {
			bar += `<span style="color:${UNFILLED_SEGMENT_COLOR};">●</span> `;
		}
	}
	return bar.trimEnd();
}

function escapeInlineMarkdown(value: string): string {
	return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function formatTimestamp(date: Date): string {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Per-model color palette. Degrades as quota drops.
 * API returns exact cuts only: 100 → 80 → 60 → 40 → 20 → exhausted.
 */
export function getModelStatusColor(label: string, percentage: number): string {
	if (percentage < 15) { return COLOR_DANGER; }

	// 1. Gemini Pro / Argon / Gemini Models bucket — Google Blue fading to Cyan
	if (label.includes('Pro') || label.includes('Argon') || label.includes('Gemini Models')) {
		if (percentage >= 80) { return '#3b82f6'; } // blue-500
		if (percentage >= 60) { return '#0ea5e9'; } // sky-500
		if (percentage >= 40) { return '#06b6d4'; } // cyan-500
		return COLOR_WARNING;                       // amber-500
	}

	// 2. Gemini Flash / Lite — Emerald fading to Lime
	if (label.includes('Flash') || label.includes('Lite')) {
		if (percentage >= 80) { return '#10b981'; } // emerald-500
		if (percentage >= 60) { return '#22c55e'; } // green-500
		if (percentage >= 40) { return '#84cc16'; } // lime-500
		return COLOR_WARNING;                       // amber-500
	}

	// 3. Claude — Anthropic Peach/Skin fading into Fuchsia (No amber anxiety!)
	if (label.includes('Claude') || label.includes('Sonnet') || label.includes('Opus')) {
		if (percentage >= 80) { return '#fdba74'; } // orange-300 (Warm Peach/Skin)
		if (percentage >= 60) { return '#fb7185'; } // rose-400 (Coral/Vivid pinkish-skin)
		if (percentage >= 40) { return '#e347c4'; } // fuchsia-500 (Fuchsia)
		return COLOR_WARNING;                       // amber-500
	}

	// 4. GPT-OSS / Third-Party — Vibrant Pink / Fuchsia
	if (label.includes('GPT')) {
		if (percentage >= 80) { return '#f472b6'; } // pink-400
		if (percentage >= 60) { return '#ec4899'; } // pink-500
		if (percentage >= 40) { return '#db2777'; } // pink-600
		return COLOR_WARNING;                       // amber-500
	}

	return COLOR_WARNING; // safety net
}

/**
 * System-wide status color for aggregate metrics (top summary bar).
 */
export function getStatusColor(percentage: number): string {
	if (percentage < 15) { return COLOR_DANGER; }
	if (percentage < 40) { return COLOR_WARNING; }
	if (percentage < 70) { return COLOR_INFO; }
	return COLOR_HEALTHY;
}

function joinWithSeparator(parts: string[]): string {
	return parts.join(` &nbsp;&nbsp;<span style="color:${COLOR_SEPARATOR};">|</span>&nbsp;&nbsp; `);
}
