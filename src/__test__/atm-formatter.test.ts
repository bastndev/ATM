import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'mocha';
import { languageRegistry } from '../extensions/28-atm-formatter/core/languageRegistry';
import { configFromVsCodeSettings, mergeConfig, formatterSettingKeys } from '../extensions/28-atm-formatter/core/options';
import { isPathIgnored, isFileIgnored } from '../extensions/28-atm-formatter/core/ignoreResolver';
import { FormatterService } from '../extensions/28-atm-formatter/core/formatterService';

suite('ATM Formatter — Language Registry', () => {
	test('typescript language ID is supported', () => {
		assert.ok(languageRegistry.isLanguageSupported('typescript'));
	});

	test('typescriptreact language ID is supported', () => {
		assert.ok(languageRegistry.isLanguageSupported('typescriptreact'));
	});

	test('css language ID is supported', () => {
		assert.ok(languageRegistry.isLanguageSupported('css'));
	});

	test('javascript language ID is NOT supported', () => {
		assert.strictEqual(languageRegistry.isLanguageSupported('javascript'), false);
	});

	test('json language ID is supported', () => {
		assert.ok(languageRegistry.isLanguageSupported('json'));
	});

	test('getByLanguageId returns typescript descriptor', () => {
		const desc = languageRegistry.getByLanguageId('typescript');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'typescript');
		assert.strictEqual(desc.parsers[0], 'typescript');
	});

	test('getByLanguageId returns css descriptor', () => {
		const desc = languageRegistry.getByLanguageId('css');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'css');
		assert.strictEqual(desc.parsers[0], 'css');
	});

	test('getByExtension finds .ts files', () => {
		const desc = languageRegistry.getByExtension('.ts');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'typescript');
	});

	test('getByExtension finds .tsx files', () => {
		const desc = languageRegistry.getByExtension('.tsx');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'typescript');
	});

	test('getByExtension finds .css files', () => {
		const desc = languageRegistry.getByExtension('.css');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'css');
	});

	test('getByExtension is case-insensitive', () => {
		const desc = languageRegistry.getByExtension('.TS');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'typescript');
	});

	test('getByExtension returns undefined for unsupported extension', () => {
		const desc = languageRegistry.getByExtension('.py');
		assert.strictEqual(desc, undefined);
	});

	test('typescript supports range formatting', () => {
		const desc = languageRegistry.getByLanguageId('typescript');
		assert.strictEqual(desc?.rangeFormatting, true);
	});

	test('css does not support range formatting', () => {
		const desc = languageRegistry.getByLanguageId('css');
		assert.strictEqual(desc?.rangeFormatting, false);
	});

	test('getRangeFormattingLanguageIds includes typescript', () => {
		const ids = languageRegistry.getRangeFormattingLanguageIds();
		assert.ok(ids.includes('typescript'));
		assert.ok(ids.includes('typescriptreact'));
	});

	test('getRangeFormattingLanguageIds excludes css', () => {
		const ids = languageRegistry.getRangeFormattingLanguageIds();
		assert.strictEqual(ids.includes('css'), false);
	});

	test('getEnabledLanguageIds returns all enabled language IDs', () => {
		const ids = languageRegistry.getEnabledLanguageIds();
		assert.ok(ids.includes('typescript'));
		assert.ok(ids.includes('typescriptreact'));
		assert.ok(ids.includes('css'));
		assert.ok(ids.includes('astro'));
	});

	test('astro language ID is supported', () => {
		assert.ok(languageRegistry.isLanguageSupported('astro'));
	});

	test('getByExtension finds .astro files', () => {
		const desc = languageRegistry.getByExtension('.astro');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'astro');
	});

	test('getByExtension finds .json files', () => {
		const desc = languageRegistry.getByExtension('.json');
		assert.ok(desc);
		assert.strictEqual(desc.id, 'json');
	});

	test('astro does not support range formatting', () => {
		const desc = languageRegistry.getByLanguageId('astro');
		assert.strictEqual(desc?.rangeFormatting, false);
	});

	test('getRangeFormattingLanguageIds excludes astro', () => {
		const ids = languageRegistry.getRangeFormattingLanguageIds();
		assert.strictEqual(ids.includes('astro'), false);
	});
});

suite('ATM Formatter — Options Mapper', () => {
	test('configFromVsCodeSettings maps basic options', () => {
		const config = configFromVsCodeSettings((key) => {
			if (key === formatterSettingKeys.printWidth) { return 100; }
			if (key === formatterSettingKeys.semi) { return false; }
			if (key === formatterSettingKeys.singleQuote) { return true; }
			return undefined;
		});
		assert.strictEqual(config.printWidth, 100);
		assert.strictEqual(config.semi, false);
		assert.strictEqual(config.singleQuote, true);
	});

	test('configFromVsCodeSettings omits undefined options', () => {
		const config = configFromVsCodeSettings(() => undefined);
		assert.strictEqual(config.printWidth, undefined);
		assert.strictEqual(config.semi, undefined);
	});

	test('configFromVsCodeSettings maps trailingComma enum', () => {
		const config = configFromVsCodeSettings((key) => {
			if (key === formatterSettingKeys.trailingComma) { return 'es5'; }
			return undefined;
		});
		assert.strictEqual(config.trailingComma, 'es5');
	});

	test('configFromVsCodeSettings rejects invalid trailingComma', () => {
		const config = configFromVsCodeSettings((key) => {
			if (key === formatterSettingKeys.trailingComma) { return 'invalid'; }
			return undefined;
		});
		assert.strictEqual(config.trailingComma, undefined);
	});

	test('configFromVsCodeSettings maps arrowParens enum', () => {
		const config = configFromVsCodeSettings((key) => {
			if (key === formatterSettingKeys.arrowParens) { return 'avoid'; }
			return undefined;
		});
		assert.strictEqual(config.arrowParens, 'avoid');
	});

	test('mergeConfig: prettier config takes precedence', () => {
		const prettier = { printWidth: 120, semi: false };
		const vsCode = { printWidth: 80, semi: true, singleQuote: true };
		const merged = mergeConfig(prettier, vsCode);
		assert.strictEqual(merged.printWidth, 120);
		assert.strictEqual(merged.semi, false);
		assert.strictEqual(merged.singleQuote, true);
	});

	test('mergeConfig: null prettier config returns vsCode config', () => {
		const vsCode = { printWidth: 80 };
		const merged = mergeConfig(null, vsCode);
		assert.strictEqual(merged.printWidth, 80);
	});
});

suite('ATM Formatter — Ignore Patterns', () => {
	test('combines .atmignore and .prettierignore patterns', () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-'));
		try {
			fs.writeFileSync(path.join(workspaceRoot, '.atmignore'), '# generated/\ngenerated/\n');
			fs.writeFileSync(path.join(workspaceRoot, '.prettierignore'), '# vendor/\nvendor/\n');
			assert.ok(isFileIgnored(path.join(workspaceRoot, 'generated/app.ts'), workspaceRoot, '.atmignore'));
			assert.ok(isFileIgnored(path.join(workspaceRoot, 'vendor/app.ts'), workspaceRoot, '.atmignore'));
		} finally {
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('exact path match ignores file', () => {
		assert.ok(isPathIgnored('/root/src/foo.ts', '/root', ['src/foo.ts']));
	});

	test('non-matching pattern does not ignore', () => {
		assert.strictEqual(isPathIgnored('/root/src/bar.ts', '/root', ['src/foo.ts']), false);
	});

	test('directory prefix ignores files under it', () => {
		assert.ok(isPathIgnored('/root/dist/index.ts', '/root', ['dist/']));
	});

	test('glob pattern matches extension', () => {
		assert.ok(isPathIgnored('/root/test.ts', '/root', ['*.ts']));
	});

	test('no patterns means nothing is ignored', () => {
		assert.strictEqual(isPathIgnored('/root/foo.ts', '/root', []), false);
	});
});

suite('ATM Formatter — Formatter Service', () => {
	const service = new FormatterService();

	test('formats TypeScript code', async () => {
		const result = await service.formatDocument({
			text: 'const x:number=1',
			parser: 'typescript',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.includes('const x: number = 1'));
	});

	test('formats TSX code', async () => {
		const result = await service.formatDocument({
			text: 'const App=()=><div/>',
			parser: 'typescript',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.length > 0);
	});

	test('formats CSS code', async () => {
		const result = await service.formatDocument({
			text: 'body{color:red}',
			parser: 'css',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.includes('body'));
	});

	test('returns error for invalid syntax', async () => {
		const result = await service.formatDocument({
			text: 'const const const',
			parser: 'typescript',
		});
		assert.ok(result.error);
	});

	test('returns original text on error', async () => {
		const original = 'const const const';
		const result = await service.formatDocument({
			text: original,
			parser: 'typescript',
		});
		assert.strictEqual(result.formatted, original);
	});

	test('getParserForLanguageId returns typescript parser', () => {
		assert.strictEqual(service.getParserForLanguageId('typescript'), 'typescript');
	});

	test('getParserForLanguageId returns css parser', () => {
		assert.strictEqual(service.getParserForLanguageId('css'), 'css');
	});

	test('getParserForLanguageId returns undefined for unsupported', () => {
		assert.strictEqual(service.getParserForLanguageId('python'), undefined);
	});

	test('supportsRangeFormatting returns true for typescript', () => {
		assert.strictEqual(service.supportsRangeFormatting('typescript'), true);
	});

	test('supportsRangeFormatting returns false for css', () => {
		assert.strictEqual(service.supportsRangeFormatting('css'), false);
	});

	test('getParserForLanguageId returns astro parser', () => {
		assert.strictEqual(service.getParserForLanguageId('astro'), 'astro');
	});

	test('getParserForLanguageId returns json parser', () => {
		assert.strictEqual(service.getParserForLanguageId('json'), 'json');
	});

	test('formats JSON', async () => {
		const result = await service.formatDocument({
			text: '{"name":"ATM","enabled":true}',
			parser: 'json',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.includes('"name": "ATM"'));
	});

	test('formats Astro code', async () => {
		const result = await service.formatDocument({
			text: '---\nconst x=1\n---\n<div style="color:red">{x}</div>',
			parser: 'astro',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.includes('const x = 1'));
	});

	test('formats Astro with embedded CSS', async () => {
		const result = await service.formatDocument({
			text: '---\nconst x=1\n---\n<style>body{color:red}</style>',
			parser: 'astro',
		});
		assert.strictEqual(result.error, undefined);
		assert.ok(result.formatted.length > 0);
	});
});
