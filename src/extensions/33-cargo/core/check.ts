import { LineSplitter } from './buildOutput';

/**
 * The pieces of the save check that need no process: its cargo command,
 * which terminal commands are cargo commands, and the one line worth
 * showing when cargo stops before checking any code.
 */

/**
 * JSON for the problems. The short form keeps each message's `rendered`
 * text to one line, since the check prints nothing anywhere.
 */
export const CHECK_MESSAGE_FORMAT = '--message-format=json-diagnostic-short';

/**
 * `cargo check` for every package of the workspace, so changing a library
 * also reports what breaks in the programs that use it. Unchanged packages
 * cost only cargo's freshness check. `extra` comes from the
 * atm.cargo.checkArgs setting; choosing packages there (-p) drops
 * --workspace.
 */
export function checkArgs(extra: readonly string[]): string[] {
	const picksPackages = extra.some((arg) => arg === '--package' || arg.startsWith('--package=') || arg.startsWith('-p'));
	return ['check', ...(picksPackages ? [] : ['--workspace']), CHECK_MESSAGE_FORMAT, ...extra];
}

/**
 * A command line that runs cargo: `cargo run`, `cargo +nightly build`,
 * `RUST_LOG=debug cargo run`, `cd app && cargo test`,
 * `~/.cargo/bin/cargo b`. A word that only starts with cargo (cargo-watch,
 * CARGO_HOME=…) doesn't count.
 */
export function isCargoCommand(commandLine: string): boolean {
	return /(?:^|[\s;&|(`])(?:[^\s;&|(`]*[\\/])?cargo(?:\.exe)?(?=\s|$)/i.test(commandLine);
}

/** The `--manifest-path` of a cargo command line, as typed (relative to the terminal's folder). */
export function manifestPathIn(commandLine: string): string | undefined {
	const match = /--manifest-path(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(commandLine);
	return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * Collects why cargo stopped without checking code (a broken Cargo.toml, a
 * missing toolchain, a failing build script): its first `error…` line, or
 * else the last line it printed. Only one line is kept at any time, however
 * much cargo prints.
 */
export class CargoFailure {
	private readonly lines = new LineSplitter();
	private firstError: string | undefined;
	private lastLine: string | undefined;

	push(chunk: string): void {
		this.lines.push(chunk).forEach((line) => this.take(line));
	}

	/** The line to show, once cargo has exited. */
	message(): string | undefined {
		this.lines.end().forEach((line) => this.take(line));
		return this.firstError ?? this.lastLine;
	}

	private take(line: string): void {
		const text = plainText(line);
		if (text.length === 0 || this.firstError !== undefined) {
			return;
		}
		if (/^error\b/.test(text)) {
			this.firstError = text;
		} else {
			this.lastLine = text;
		}
	}
}

/** A line without colour codes, as it looks once carriage returns have overwritten it. */
function plainText(line: string): string {
	const visible = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
	return visible.slice(visible.lastIndexOf('\r') + 1).trim();
}
