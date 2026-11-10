import * as fs from 'fs';
import * as path from 'path';
import ignore = require('ignore');

export function literalIgnorePattern(relativePath: string, isDirectory: boolean): string {
	// Explorer selections are literal paths, even when names contain glob characters.
	return '/' + relativePath.replace(/([*?[\]\\ ])/g, '\\$1') + (isDirectory ? '/' : '');
}

export function isPathIgnored(filePath: string, baseDirectory: string, patterns: string[]): boolean {
	const relative = path.relative(baseDirectory, filePath).split(path.sep).join('/');
	if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
		return false;
	}
	return ignore({ ignorecase: false }).add(patterns).ignores(relative);
}

export function isFileIgnored(filePath: string, workspaceRoot: string, ignorePath: string): boolean {
	const rulesPath = path.resolve(workspaceRoot, ignorePath);
	let content: string;
	try {
		content = fs.readFileSync(rulesPath, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return false; }
		throw error;
	}
	return isPathIgnored(filePath, path.dirname(rulesPath), content.split(/\r?\n/));
}
