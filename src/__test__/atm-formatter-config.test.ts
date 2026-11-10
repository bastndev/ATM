import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, setup, teardown, test } from 'mocha';
import { resolveConfigForFile } from '../extensions/28-atm-formatter/core/configResolver';

suite('ATM Formatter — Native Configuration', () => {
	let directory: string;
	let file: string;
	setup(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-native-'));
		file = path.join(directory, 'app.ts');
		fs.writeFileSync(file, 'const x=1');
	});
	teardown(() => fs.rmSync(directory, { recursive: true, force: true }));

	const formats = [
		{ name: '.prettierrc', content: 'semi: false\nprintWidth: 90\n' },
		{ name: '.prettierrc.yaml', content: 'semi: false\nprintWidth: 90\n' },
		{ name: '.prettierrc.json5', content: '{semi: false, printWidth: 90,}' },
		{ name: '.prettierrc.toml', content: 'semi = false\nprintWidth = 90\n' },
		{ name: 'prettier.config.cjs', content: 'module.exports = {semi: false, printWidth: 90};' },
		{ name: 'prettier.config.mjs', content: 'export default {semi: false, printWidth: 90};' },
	];
	for (const { name, content } of formats) {
		test('loads ' + name, async () => {
			fs.writeFileSync(path.join(directory, name), content);
			const result = await resolveConfigForFile(file, true);
			assert.strictEqual(result.configPath, path.join(directory, name));
			assert.strictEqual(result.config?.semi, false);
			assert.strictEqual(result.config?.printWidth, 90);
		});
	}

	test('overrides apply to the matching document only', async () => {
		fs.writeFileSync(path.join(directory, '.prettierrc'), JSON.stringify({
			semi: true, overrides: [{ files: '*.ts', excludeFiles: '*.test.ts', options: { semi: false } }],
		}));
		assert.strictEqual((await resolveConfigForFile(file, true)).config?.semi, false);
		assert.strictEqual((await resolveConfigForFile(path.join(directory, 'app.test.ts'), true)).config?.semi, true);
		assert.strictEqual((await resolveConfigForFile(path.join(directory, 'app.css'), true)).config?.semi, true);
	});

	test('EditorConfig supplies indentation and Prettier options override it', async () => {
		fs.writeFileSync(path.join(directory, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 4\n');
		const initial = await resolveConfigForFile(file, true);
		assert.strictEqual(initial.configPath, null);
		assert.strictEqual(initial.config?.tabWidth, 4);
		fs.writeFileSync(path.join(directory, '.prettierrc'), '{"tabWidth":2}');
		assert.strictEqual((await resolveConfigForFile(file, true)).config?.tabWidth, 2);
	});

	test('configuration creation, edits and deletion take effect without stale data', async () => {
		const config = path.join(directory, '.prettierrc.yaml');
		assert.strictEqual((await resolveConfigForFile(file, true)).configPath, null);
		fs.writeFileSync(config, 'tabWidth: 3');
		assert.strictEqual((await resolveConfigForFile(file, true)).config?.tabWidth, 3);
		fs.writeFileSync(config, 'tabWidth: 5');
		assert.strictEqual((await resolveConfigForFile(file, true)).config?.tabWidth, 5);
		fs.unlinkSync(config);
		assert.strictEqual((await resolveConfigForFile(file, true)).configPath, null);
	});

	test('untrusted resolution does not execute project config or read its options', async () => {
		const sentinel = path.join(directory, 'executed');
		fs.writeFileSync(path.join(directory, 'prettier.config.cjs'),
			'require("fs").writeFileSync(' + JSON.stringify(sentinel) + ', "executed"); module.exports = {semi:false};');
		assert.deepStrictEqual(await resolveConfigForFile(file, false), { config: null, configPath: null });
		assert.strictEqual(fs.existsSync(sentinel), false);
	});
});
