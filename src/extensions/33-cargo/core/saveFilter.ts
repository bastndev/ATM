import * as path from 'path';
import { isInside } from './paths';

/**
 * Which saved files rebuild the running program when restart-on-save is
 * on: Rust files and Cargo's own files inside the workspace. Nothing in the
 * build folder counts, since cargo writes there itself.
 */

const CARGO_FILES = new Set(['Cargo.toml', 'Cargo.lock']);

export function triggersRestart(file: string, scope: { root: string; targetDir: string }): boolean {
	if (!isInside(scope.root, file) || isInside(scope.targetDir, file)) {
		return false;
	}
	return file.endsWith('.rs') || CARGO_FILES.has(path.basename(file));
}
