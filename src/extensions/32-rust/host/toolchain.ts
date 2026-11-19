import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NO_AUTO_INSTALL } from '../core/rustup';

/**
 * Finds cargo and rustfmt on Windows, macOS and Linux. Each is looked up on
 * PATH and in Cargo's bin folder (VS Code started from a desktop launcher
 * often lacks ~/.cargo/bin on PATH), and only counts if `--version` works:
 * rustup leaves shortcuts for tools that fail until their component is
 * installed. Every check and every rustfmt run is told not to install
 * toolchains (see core/rustup.ts).
 */

export type RustTool = 'cargo' | 'rustfmt';

const VERSION_TIMEOUT_MS = 15_000;

export function cargoBinDir(): string {
	const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
	return path.join(cargoHome, 'bin');
}

function inCargoHome(tool: RustTool): string {
	return path.join(cargoBinDir(), tool + (process.platform === 'win32' ? '.exe' : ''));
}

function candidates(tool: RustTool): string[] {
	return fs.existsSync(inCargoHome(tool)) ? [tool, inCargoHome(tool)] : [tool];
}

/**
 * What to start when findTool found no working copy, for example because the
 * project's toolchain isn't installed: rustup's shortcut in Cargo's bin
 * folder if there is one, so the error shown comes from rustup and says what
 * to do, rather than "command not found".
 */
export function toolCommand(tool: RustTool): string {
	return fs.existsSync(inCargoHome(tool)) ? inCargoHome(tool) : tool;
}

function toolEnv(): NodeJS.ProcessEnv {
	return { ...process.env, ...NO_AUTO_INSTALL };
}

function works(command: string, cwd: string | undefined): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(command, ['--version'], { cwd, env: toolEnv(), timeout: VERSION_TIMEOUT_MS, windowsHide: true }, (error) => resolve(!error));
	});
}

const cache = new Map<string, Promise<string | undefined>>();

/**
 * The first working copy of `tool`, or undefined. `cwd` matters because
 * rustup picks the toolchain from rust-toolchain.toml in that folder. A
 * tool that is missing is looked up again next time, so installing it
 * while the editor is open is enough.
 */
export function findTool(tool: RustTool, cwd: string | undefined): Promise<string | undefined> {
	const key = `${tool}\0${cwd ?? ''}`;
	let found = cache.get(key);
	if (!found) {
		found = lookUp(tool, cwd).then((result) => {
			if (!result) {
				cache.delete(key);
			}
			return result;
		});
		cache.set(key, found);
	}
	return found;
}

async function lookUp(tool: RustTool, cwd: string | undefined): Promise<string | undefined> {
	for (const candidate of candidates(tool)) {
		if (await works(candidate, cwd)) {
			return candidate;
		}
	}
	return undefined;
}

/** Formats `source` with rustfmt through stdin. Resolves undefined when rustfmt rejects the code. */
export function runRustfmt(rustfmt: string, source: string, edition: string, cwd: string | undefined): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = execFile(
			rustfmt,
			['--edition', edition, '--emit', 'stdout'],
			{ cwd, env: toolEnv(), timeout: VERSION_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
			(error, stdout) => resolve(error ? undefined : stdout),
		);
		child.stdin?.end(source);
	});
}
