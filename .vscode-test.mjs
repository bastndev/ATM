import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-formatter-workspace-'));
const folders = ['A', 'B'].map((name, index) => {
	const folder = path.join(fixture, name);
	fs.mkdirSync(path.join(folder, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(folder, '.vscode', 'settings.json'), JSON.stringify({
		'atm.formatter.semi': index !== 0,
		'atm.formatter.ignorePath': 'formatter.ignore',
	}));
	return { name: 'ATM Formatter ' + name, path: folder };
});
const workspace = path.join(fixture, 'formatter.code-workspace');
fs.writeFileSync(workspace, JSON.stringify({ folders }));
process.once('exit', () => fs.rmSync(fixture, { recursive: true, force: true }));

export default defineConfig([
	{ label: 'main', files: 'out/__test__/**/*.test.js' },
	{
		label: 'formatter-workspace',
		files: 'out/__test__/atm-formatter-workspace.test.js',
		workspaceFolder: workspace,
	},
]);
