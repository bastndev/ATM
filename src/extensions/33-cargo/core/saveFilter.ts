import * as path from 'path';
import { isInside } from './paths';

/**
 * Which saved files can change what cargo builds: Rust files and Cargo's
 * own files inside the workspace. They start the save check, and rebuild
 * the running program when restart-on-save is on. Nothing in the build
 * folder counts, since cargo writes there itself.
 */

const CARGO_FILES = new Set(['Cargo.toml', 'Cargo.lock']);

/** A Rust or Cargo file anywhere; the cheap test before looking for its workspace. */
export function isCargoSource(file: string): boolean {
	return file.endsWith('.rs') || CARGO_FILES.has(path.basename(file));
}

export function affectsBuild(file: string, scope: { root: string; targetDir: string }): boolean {
	return isCargoSource(file) && isInside(scope.root, file) && !isInside(scope.targetDir, file);
}
