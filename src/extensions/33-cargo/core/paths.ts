import * as path from 'path';

/**
 * Path checks that work the same for paths from cargo and from VS Code. On
 * Windows the two can disagree on letter case (`c:\` vs `C:\`), so paths
 * are compared without case there.
 */

const foldCase = process.platform === 'win32';

function normalize(file: string): string {
	const resolved = path.resolve(file);
	return foldCase ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string): boolean {
	return normalize(a) === normalize(b);
}

/** True when `file` is `dir` itself or anywhere below it. */
export function isInside(dir: string, file: string): boolean {
	const relative = path.relative(normalize(dir), normalize(file));
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
