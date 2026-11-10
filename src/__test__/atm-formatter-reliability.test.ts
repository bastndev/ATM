import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test, setup, teardown } from 'mocha';
import { resolveConfigForFile } from '../extensions/28-atm-formatter/core/configResolver';
import { isPathIgnored, isFileIgnored, literalIgnorePattern } from '../extensions/28-atm-formatter/core/ignoreResolver';

suite('ATM Formatter — Ignore Reliability', () => {
	let workspaceRoot: string;
	setup(() => { workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-')); });
	teardown(() => { fs.rmSync(workspaceRoot, { recursive: true, force: true }); });

	test('honors both .atmignore and .prettierignore independently', () => {
		fs.writeFileSync(path.join(workspaceRoot, '.atmignore'), 'generated/\n!vendor/\n');
		fs.writeFileSync(path.join(workspaceRoot, '.prettierignore'), 'vendor/\n!generated/\n');
		assert.ok(isFileIgnored(path.join(workspaceRoot, 'generated/app.ts'), workspaceRoot, '.atmignore'));
		assert.ok(isFileIgnored(path.join(workspaceRoot, 'vendor/app.ts'), workspaceRoot, '.atmignore'));
		assert.strictEqual(isFileIgnored(path.join(workspaceRoot, 'src/app.ts'), workspaceRoot, '.atmignore'), false);
	});

	test('missing ignore files allow formatting', () => {
		assert.strictEqual(isFileIgnored(path.join(workspaceRoot, 'app.ts'), workspaceRoot, '.atmignore'), false);
	});

	for (const relativePath of ['src/routes/[id].ts', '#file.ts', '!file.ts', 'file*.ts', 'file?.ts', ' file.ts ']) {
		test('Explorer selections escape literal filenames: ' + relativePath, () => {
			const pattern = literalIgnorePattern(relativePath, false);
			assert.ok(isPathIgnored(path.join(workspaceRoot, relativePath), workspaceRoot, [pattern]));
			assert.strictEqual(isPathIgnored(path.join(workspaceRoot, 'nested', relativePath), workspaceRoot, [pattern]), false);
		});
	}

	test('Explorer directory selections keep bracket names literal', () => {
		const pattern = literalIgnorePattern('src/[id]', true);
		assert.ok(isPathIgnored(path.join(workspaceRoot, 'src/[id]/app.ts'), workspaceRoot, [pattern]));
		assert.strictEqual(isPathIgnored(path.join(workspaceRoot, 'src/i/app.ts'), workspaceRoot, [pattern]), false);
	});

	test('unreadable ignore paths are reported instead of allowing formatting', () => {
		fs.mkdirSync(path.join(workspaceRoot, '.atmignore'));
		assert.throws(() => isFileIgnored(path.join(workspaceRoot, 'app.ts'), workspaceRoot, '.atmignore'));
	});

	test('custom ignore paths anchor patterns to the ignore file directory', () => {
		fs.mkdirSync(path.join(workspaceRoot, 'nested'));
		const ignoreFile = path.join(workspaceRoot, 'nested/custom.ignore');
		fs.writeFileSync(ignoreFile, '/generated/\n');
		for (const setting of ['nested/custom.ignore', ignoreFile]) {
			assert.ok(isFileIgnored(path.join(workspaceRoot, 'nested/generated/app.ts'), workspaceRoot, setting));
			assert.strictEqual(isFileIgnored(path.join(workspaceRoot, 'generated/app.ts'), workspaceRoot, setting), false);
		}
	});

	test('ignore changes take effect on the next check', () => {
		const file = path.join(workspaceRoot, 'app.ts');
		fs.writeFileSync(path.join(workspaceRoot, '.atmignore'), '*.ts\n');
		assert.ok(isFileIgnored(file, workspaceRoot, '.atmignore'));
		fs.writeFileSync(path.join(workspaceRoot, '.atmignore'), '');
		assert.strictEqual(isFileIgnored(file, workspaceRoot, '.atmignore'), false);
	});

	const cases: { name: string; patterns: string[]; file: string; ignored: boolean }[] = [
		{ name: 'recursive glob includes workspace root files', patterns: ['**/*.ts'], file: 'app.ts', ignored: true },
		{ name: 'recursive glob includes nested files', patterns: ['**/*.ts'], file: 'src/deep/app.ts', ignored: true },
		{ name: 'root anchored directory', patterns: ['/dist/'], file: 'dist/app.ts', ignored: true },
		{ name: 'root anchor excludes nested directories', patterns: ['/dist/'], file: 'packages/app/dist/app.ts', ignored: false },
		{ name: 'bare directory name', patterns: ['dist'], file: 'packages/app/dist/app.ts', ignored: true },
		{ name: 'directory matches at any depth', patterns: ['dist/'], file: 'packages/app/dist/app.ts', ignored: true },
		{ name: 'recursive directory glob', patterns: ['**/dist/'], file: 'packages/app/dist/app.ts', ignored: true },
		{ name: 'negation restores a matched file', patterns: ['src/*', '!src/keep.ts'], file: 'src/keep.ts', ignored: false },
		{ name: 'later exclusion wins', patterns: ['*.ts', '!keep.ts', 'keep.ts'], file: 'keep.ts', ignored: true },
		{ name: 'excluded parent must be restored first', patterns: ['src/', '!src/keep.ts'], file: 'src/keep.ts', ignored: true },
		{ name: 'question mark glob', patterns: ['foo?.ts'], file: 'foo1.ts', ignored: true },
		{ name: 'character class glob', patterns: ['file[12].ts'], file: 'file2.ts', ignored: true },
		{ name: 'regex punctuation stays literal', patterns: ['*.test.ts'], file: 'fooXtestYts', ignored: false },
		{ name: 'parenthesis stays literal', patterns: ['(foo*.ts'], file: '(foobar.ts', ignored: true },
		{ name: 'escaped hash filename', patterns: ['\\#file.ts'], file: '#file.ts', ignored: true },
		{ name: 'escaped exclamation filename', patterns: ['\\!file.ts'], file: '!file.ts', ignored: true },
		{ name: 'escaped wildcard filename', patterns: ['file\\*.ts'], file: 'file*.ts', ignored: true },
		{ name: 'escaped wildcard does not expand', patterns: ['file\\*.ts'], file: 'file1.ts', ignored: false },
		{ name: 'leading filename spaces survive', patterns: [' file.ts'], file: ' file.ts', ignored: true },
		{ name: 'escaped trailing filename spaces survive', patterns: ['file.ts\\ '], file: 'file.ts ', ignored: true },
		{ name: 'comments and blank lines', patterns: ['# comment', '', '   '], file: 'app.ts', ignored: false },
		{ name: 'outside paths are not matched', patterns: ['**'], file: '../other/app.ts', ignored: false },
		{ name: 'case sensitive matching', patterns: ['App.ts'], file: 'app.ts', ignored: false },
	];
	for (const { name, patterns, file, ignored } of cases) {
		test(name, () => {
			assert.strictEqual(isPathIgnored(path.join(workspaceRoot, file), workspaceRoot, patterns), ignored);
		});
	}

	test('CRLF ignore files preserve escaped patterns and negation', () => {
		fs.writeFileSync(path.join(workspaceRoot, '.atmignore'), '# comment\r\n*.ts\r\n!keep.ts\r\n\\#data.json\r\n');
		assert.ok(isFileIgnored(path.join(workspaceRoot, 'app.ts'), workspaceRoot, '.atmignore'));
		assert.ok(isFileIgnored(path.join(workspaceRoot, '#data.json'), workspaceRoot, '.atmignore'));
		assert.strictEqual(isFileIgnored(path.join(workspaceRoot, 'keep.ts'), workspaceRoot, '.atmignore'), false);
	});
});

suite('ATM Formatter — Configuration Errors', () => {
	let workspaceRoot: string;
	let filePath: string;
	setup(() => {
		workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-config-'));
		filePath = path.join(workspaceRoot, 'app.ts');
	});
	teardown(() => { fs.rmSync(workspaceRoot, { recursive: true, force: true }); });

	test('missing configuration is distinct from invalid configuration', () => {
		assert.deepStrictEqual(resolveConfigForFile(filePath, workspaceRoot), { config: null, configPath: null });
	});

	for (const content of ['{', 'null', '[]', '"shared-config"', '42', 'semi: false']) {
		test('rejects invalid or unsupported configuration: ' + content, () => {
			const configPath = path.join(workspaceRoot, '.prettierrc');
			fs.writeFileSync(configPath, content);
			assert.throws(() => resolveConfigForFile(filePath, workspaceRoot), (error: Error) => error.message.includes(configPath));
		});
	}

	test('invalid nearest config does not fall back to valid parent config', () => {
		fs.writeFileSync(path.join(workspaceRoot, '.prettierrc'), '{"semi":false}');
		fs.mkdirSync(path.join(workspaceRoot, 'src'));
		const configPath = path.join(workspaceRoot, 'src/.prettierrc.json');
		fs.writeFileSync(configPath, '{');
		assert.throws(() => resolveConfigForFile(path.join(workspaceRoot, 'src/app.ts'), workspaceRoot), /Invalid configuration/);
	});

	test('accepts valid empty and BOM-prefixed config objects', () => {
		fs.writeFileSync(path.join(workspaceRoot, '.prettierrc'), '\uFEFF{}');
		assert.deepStrictEqual(resolveConfigForFile(filePath, workspaceRoot).config, {});
	});

	test('loads package.json configuration', () => {
		fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"prettier":{"semi":false}}');
		assert.deepStrictEqual(resolveConfigForFile(filePath, workspaceRoot).config, { semi: false });
	});

	test('ignores package.json without a prettier field', () => {
		fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"test"}');
		assert.strictEqual(resolveConfigForFile(filePath, workspaceRoot).configPath, null);
	});

	for (const content of ['{', '{"prettier":[]}', '{"prettier":null}', '{"prettier":"shared-config"}']) {
		test('reports invalid package.json config: ' + content, () => {
			const configPath = path.join(workspaceRoot, 'package.json');
			fs.writeFileSync(configPath, content);
			assert.throws(() => resolveConfigForFile(filePath, workspaceRoot), (error: Error) => error.message.includes(configPath));
		});
	}
});
