import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Finds the Rust programs on Windows, macOS and Linux. Each is looked up on
 * PATH and in Cargo's bin folder (VS Code started from a desktop launcher
 * often lacks ~/.cargo/bin on PATH), and only counts if `--version` works:
 * rustup leaves a `rust-analyzer` shortcut that fails until the component
 * is installed.
 */

export type RustTool = 'cargo' | 'rustup' | 'rustfmt' | 'rust-analyzer';

const VERSION_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export function cargoBinDir(): string {
	const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
	return path.join(cargoHome, 'bin');
}

function candidates(tool: RustTool): string[] {
	const exe = process.platform === 'win32' ? '.exe' : '';
	const inCargoHome = path.join(cargoBinDir(), tool + exe);
	return fs.existsSync(inCargoHome) ? [tool, inCargoHome] : [tool];
}

function run(command: string, args: string[], cwd: string | undefined, timeout: number): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		execFile(command, args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
			resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
		});
	});
}

const cache = new Map<string, Promise<string | undefined>>();

/**
 * The first working copy of `tool`, or undefined. `cwd` matters because
 * rustup picks the toolchain from rust-toolchain.toml in that folder.
 */
export function findTool(tool: RustTool, cwd: string | undefined, explicitPath?: string): Promise<string | undefined> {
	const key = `${tool}\0${cwd ?? ''}\0${explicitPath ?? ''}`;
	let found = cache.get(key);
	if (!found) {
		found = (async () => {
			const list = explicitPath ? [expandHome(explicitPath)] : candidates(tool);
			for (const candidate of list) {
				if ((await run(candidate, ['--version'], cwd, VERSION_TIMEOUT_MS)).ok) {
					return candidate;
				}
			}
			return undefined;
		})();
		cache.set(key, found);
	}
	return found;
}

/** Forget earlier lookups, e.g. after installing rust-analyzer. */
export function clearToolCache(): void {
	cache.clear();
}

function expandHome(file: string): string {
	return file.startsWith('~/') || file === '~' ? path.join(os.homedir(), file.slice(1)) : file;
}

/** `rustup component add rust-analyzer` for the toolchain that `cwd` uses. */
export async function installRustAnalyzer(rustup: string, cwd: string | undefined): Promise<{ ok: boolean; output: string }> {
	const result = await run(rustup, ['component', 'add', 'rust-analyzer'], cwd, INSTALL_TIMEOUT_MS);
	clearToolCache();
	return result;
}

/** Formats `source` with rustfmt through stdin. Resolves undefined when rustfmt rejects the code. */
export function runRustfmt(rustfmt: string, source: string, edition: string, cwd: string | undefined): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = execFile(
			rustfmt,
			['--edition', edition, '--emit', 'stdout'],
			{ cwd, timeout: VERSION_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
			(error, stdout) => resolve(error ? undefined : stdout),
		);
		child.stdin?.end(source);
	});
}
