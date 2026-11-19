import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { NO_AUTO_INSTALL } from '../../32-rust/core/rustup';
import { findTool, toolCommand } from '../../32-rust/host/toolchain';
import { CargoWorkspace, parseMetadata } from '../core/metadata';

/**
 * The short cargo and rustc calls Cargo Run makes before building. Every
 * one is told not to install toolchains (see 32-rust/core/rustup.ts), so a
 * project pinned to a missing Rust version shows rustup's message instead
 * of starting a large download.
 */

const METADATA_TIMEOUT_MS = 60_000;
const RUSTC_TIMEOUT_MS = 15_000;

/** The cargo to use in `cwd`: a working copy, or rustup's shortcut so its error message shows. */
export async function cargoFor(cwd: string): Promise<string> {
	return (await findTool('cargo', cwd)) ?? toolCommand('cargo');
}

/** The workspace around `cwd`. Rejects with cargo's own message, such as a broken Cargo.toml. */
export function readWorkspace(cargo: string, cwd: string): Promise<CargoWorkspace> {
	return new Promise((resolve, reject) => {
		execFile(
			cargo,
			['metadata', '--no-deps', '--format-version', '1'],
			{ cwd, env: toolEnv(), timeout: METADATA_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
			(error, stdout, stderr) => {
				const workspace = error ? undefined : parseMetadata(stdout);
				if (workspace) {
					resolve(workspace);
				} else {
					reject(new Error(cleanError(stderr) || error?.message || 'cargo metadata failed'));
				}
			},
		);
	});
}

const libDirs = new Map<string, Promise<string | undefined>>();

/**
 * The toolchain's library folder (`rustc --print target-libdir`). cargo run
 * adds it to the library path, which programs built with dynamic linking
 * need to find Rust's standard library. Undefined when rustc can't say.
 */
export function toolchainLibDir(cargo: string, cwd: string): Promise<string | undefined> {
	const rustc = rustcNextTo(cargo);
	const key = `${rustc}\0${cwd}`;
	let found = libDirs.get(key);
	if (!found) {
		found = new Promise((resolve) => {
			execFile(rustc, ['--print', 'target-libdir'], { cwd, env: toolEnv(), timeout: RUSTC_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
				const dir = stdout.trim();
				if (error || dir.length === 0) {
					// Asked again next time, so installing the toolchain while the editor is open is enough.
					libDirs.delete(key);
					resolve(undefined);
				} else {
					resolve(dir);
				}
			});
		});
		libDirs.set(key, found);
	}
	return found;
}

/** rustc from the same folder as cargo (both are rustup shortcuts there), else the one on PATH. */
function rustcNextTo(cargo: string): string {
	const name = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
	const sibling = path.join(path.dirname(cargo), name);
	return path.isAbsolute(cargo) && fs.existsSync(sibling) ? sibling : 'rustc';
}

function toolEnv(): NodeJS.ProcessEnv {
	return { ...process.env, ...NO_AUTO_INSTALL };
}

/** cargo's message without the colour codes and blank lines. */
function cleanError(stderr: string): string {
	return stderr.replace(/\x1b\[[0-9;]*m/g, '').trim();
}
