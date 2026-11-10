/**
 * @module ai-data-id.test
 * Unit tests for the Antigravity AI Data extension (Antigravity 1.x & 2.0 compatibility).
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */

import * as assert from 'assert';
import { ProcessFinder } from '../extensions/01-ai-data-id/core/process-finder';
import { QuotaManager } from '../extensions/01-ai-data-id/core/quota-manager';
import {
	getStatusColor,
	getModelStatusColor,
	generateModernBar,
	computeEngineeredTokens,
} from '../extensions/01-ai-data-id/ui/tooltip-builder';

suite('AI Data Extension – Unit Tests', () => {

	// ── QuotaManager.formatTime ──────────────────────────────────────

	suite('QuotaManager.formatTime', () => {
		test('returns "Ready" for zero or negative values', () => {
			assert.strictEqual(QuotaManager.formatTime(0), 'Ready');
			assert.strictEqual(QuotaManager.formatTime(-1000), 'Ready');
			assert.strictEqual(QuotaManager.formatTime(-999999), 'Ready');
		});

		test('formats minutes correctly (< 60 min)', () => {
			assert.strictEqual(QuotaManager.formatTime(60_000), '1m');     // 1 min
			assert.strictEqual(QuotaManager.formatTime(300_000), '5m');    // 5 min
			assert.strictEqual(QuotaManager.formatTime(3_540_000), '59m'); // 59 min
		});

		test('formats hours and minutes correctly', () => {
			assert.strictEqual(QuotaManager.formatTime(3_600_000), '1h 0m');      // 1h exactly
			assert.strictEqual(QuotaManager.formatTime(5_400_000), '1h 30m');     // 1h 30m
			assert.strictEqual(QuotaManager.formatTime(82_800_000), '23h 0m');    // 23h
		});

		test('formats days and hours for ≥ 24h', () => {
			assert.strictEqual(QuotaManager.formatTime(86_400_000), '1d 0h');     // 24h exactly
			assert.strictEqual(QuotaManager.formatTime(90_000_000), '1d 1h');     // 25h
			assert.strictEqual(QuotaManager.formatTime(172_800_000), '2d 0h');    // 48h exactly
		});

		test('rounds up partial minutes', () => {
			// 30 seconds → should round up to 1m
			assert.strictEqual(QuotaManager.formatTime(30_000), '1m');
			// 61 seconds → should round up to 2m
			assert.strictEqual(QuotaManager.formatTime(61_000), '2m');
		});
	});

	// ── ProcessFinder CLI parsing (Antigravity 1.x & 2.0) ────────────

	suite('ProcessFinder CLI extraction', () => {
		test('extracts CSRF token from underscore, hyphen, and equals formats', () => {
			assert.strictEqual(
				ProcessFinder.extractCsrfToken('/path/to/language_server --csrf_token abc-123_DEF'),
				'abc-123_DEF'
			);
			assert.strictEqual(
				ProcessFinder.extractCsrfToken('/path/to/language_server --csrf-token=xyz-987'),
				'xyz-987'
			);
			assert.strictEqual(
				ProcessFinder.extractCsrfToken('/path/to/language_server --csrfToken "tok_456"'),
				'tok_456'
			);
			assert.strictEqual(
				ProcessFinder.extractCsrfToken('/path/to/language_server --other_flag 1'),
				null
			);
		});

		test('extracts explicit CLI ports from command line flags', () => {
			const cmd = '/Applications/Antigravity.app/language_server --extension_server_port 42100 --port=42101 --csrf_token abc';
			assert.deepStrictEqual(ProcessFinder.extractCliPorts(cmd), [42100, 42101]);
		});
	});

	// ── QuotaManager Antigravity 2.0 RetrieveUserQuotaSummary ────────

	suite('QuotaManager.parseQuotaSummaryResponse', () => {
		test('parses multi-group 5h and weekly quota buckets correctly', () => {
			const manager = new QuotaManager();
			const futureIso = new Date(Date.now() + 3_600_000).toISOString();

			const snapshot = manager.parseQuotaSummaryResponse(
				{
					response: {
						groups: [
							{
								displayName: 'Gemini Models',
								buckets: [
									{
										bucketId: 'gemini-5h',
										displayName: 'Five Hour Limit',
										window: '5h',
										remainingFraction: 0.85,
										resetTime: futureIso,
									},
									{
										bucketId: 'gemini-weekly',
										displayName: 'Weekly Limit',
										window: 'weekly',
										remainingFraction: 0.95,
										resetTime: futureIso,
									},
								],
							},
							{
								displayName: 'Claude and GPT models',
								buckets: [
									{
										bucketId: 'claude-weekly',
										displayName: 'Weekly Limit',
										window: 'weekly',
										remainingFraction: 0,
										resetTime: futureIso,
									},
								],
							},
						],
					},
				},
				{ planName: 'Google AI Pro', teamsTier: 'PRO' }
			);

			assert.strictEqual(snapshot.planName, 'Google AI Pro');
			assert.strictEqual(snapshot.teamsTier, 'PRO');
			assert.strictEqual(snapshot.models.length, 3);

			assert.strictEqual(snapshot.models[0].label, 'Gemini Models (5h)');
			assert.strictEqual(snapshot.models[0].remainingPercentage, 85);
			assert.strictEqual(snapshot.models[0].isExhausted, false);

			assert.strictEqual(snapshot.models[1].label, 'Gemini Models (Weekly)');
			assert.strictEqual(snapshot.models[1].remainingPercentage, 95);

			assert.strictEqual(snapshot.models[2].label, 'Claude and GPT models (Weekly)');
			assert.strictEqual(snapshot.models[2].remainingPercentage, 0);
			assert.strictEqual(snapshot.models[2].isExhausted, true);
		});
	});

	// ── getStatusColor & getModelStatusColor ─────────────────────────

	suite('getStatusColor & getModelStatusColor', () => {
		test('returns rose red for danger zone (< 15%)', () => {
			assert.strictEqual(getStatusColor(0), '#f43f5e');
			assert.strictEqual(getStatusColor(14), '#f43f5e');
		});

		test('returns amber yellow for warning zone (15–39%)', () => {
			assert.strictEqual(getStatusColor(15), '#f59e0b');
			assert.strictEqual(getStatusColor(39), '#f59e0b');
		});

		test('returns sky blue for info zone (40–69%)', () => {
			assert.strictEqual(getStatusColor(40), '#0ea5e9');
			assert.strictEqual(getStatusColor(69), '#0ea5e9');
		});

		test('returns emerald green for healthy zone (≥ 70%)', () => {
			assert.strictEqual(getStatusColor(70), '#10b981');
			assert.strictEqual(getStatusColor(100), '#10b981');
		});

		test('assigns correct family palette to Gemini 4 Argon, Gemini 3.8 Flash, and buckets', () => {
			assert.strictEqual(getModelStatusColor('Gemini 4 Argon (High)', 90), '#3b82f6');
			assert.strictEqual(getModelStatusColor('Gemini Models (5h)', 85), '#3b82f6');
			assert.strictEqual(getModelStatusColor('Gemini 3.8 Flash (High)', 90), '#10b981');
			assert.strictEqual(getModelStatusColor('Claude 3.7 Sonnet', 90), '#fdba74');
		});
	});

	// ── computeEngineeredTokens ──────────────────────────────────────

	suite('computeEngineeredTokens', () => {
		test('computes PRO tier tokens across modern Argon and Flash models', () => {
			const resetTime = new Date(Date.now() + 3_600_000);
			const result = computeEngineeredTokens(
				[
					{
						label: 'Gemini 4 Argon (High)',
						modelId: 'gemini-4-argon-high',
						remainingFraction: 0.8,
						remainingPercentage: 80,
						isExhausted: false,
						resetTime,
						timeUntilReset: 3_600_000,
						timeUntilResetFormatted: '1h 0m',
					},
					{
						label: 'Gemini 3.8 Flash (High)',
						modelId: 'gemini-3.8-flash-high',
						remainingFraction: 1.0,
						remainingPercentage: 100,
						isExhausted: false,
						resetTime,
						timeUntilReset: 3_600_000,
						timeUntilResetFormatted: '1h 0m',
					},
				],
				'PRO'
			);

			assert.strictEqual(result.type, 'measured');
			if (result.type === 'measured') {
				assert.strictEqual(result.monthly, 30000);
				assert.strictEqual(result.available, 26000);
			}
		});
	});

	// ── generateModernBar ────────────────────────────────────────────

	suite('generateModernBar', () => {
		test('generates a bar with 15 segments', () => {
			const bar = generateModernBar(50, '#10b981');
			// Count the number of ● characters
			const dots = (bar.match(/●/g) || []).length;
			assert.strictEqual(dots, 15);
		});

		test('generates all unfilled dots for 0%', () => {
			const bar = generateModernBar(0, '#f43f5e');
			// All dots should use the unfilled color
			assert.ok(!bar.includes('#f43f5e'), 'Should not contain the filled color');
		});

		test('generates all filled dots for 100%', () => {
			const bar = generateModernBar(100, '#10b981');
			// All dots should use the base color with alpha
			assert.ok(bar.includes('#10b981'), 'Should contain the filled color');
			assert.ok(!bar.includes('#ffffff0f'), 'Should not contain the unfilled color');
		});

		test('returns a non-empty string', () => {
			const bar = generateModernBar(42, '#0ea5e9');
			assert.ok(bar.length > 0);
		});
	});
});
