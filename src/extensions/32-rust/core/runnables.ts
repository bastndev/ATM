import { CrateTarget, FileTarget } from './cargoTarget';
import { RunTarget } from './runTargets';
import { NO_AUTO_INSTALL } from './rustup';

/**
 * What a ▶ Run button runs: one cargo command in the package folder. The
 * arguments match rust-analyzer's, so a test runs alone (`--exact`), shows
 * its println! output (`--nocapture`) and runs even when marked #[ignore].
 */

export interface Runnable {
	/** Task or terminal name, such as "run app" or "test tests::adds". */
	label: string;
	/** Package folder; cargo runs here. */
	cwd: string;
	cargoArgs: string[];
	/** Arguments after `--`, for the program or the test runner. */
	executableArgs: string[];
}

export interface ProcessSpec {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

/** The cargo subcommand that starts a crate root's own main(). A library has none. */
const MAIN_COMMANDS: Partial<Record<CrateTarget['kind'], string>> = { bin: 'run', example: 'run', test: 'test', bench: 'bench' };

/** The command for a button, or undefined when cargo can't run it (main() of a library, tests without the harness). */
export function buildRunnable(target: RunTarget, file: FileTarget): Runnable | undefined {
	const crate = file.target;
	const selection = ['--package', file.packageName, ...targetArgs(crate)];
	if (crate.requiredFeatures.length > 0) {
		selection.push('--features', crate.requiredFeatures.join(','));
	}

	if (target.kind === 'main') {
		const command = MAIN_COMMANDS[crate.kind];
		// Only a crate root's main() starts a program; tests and benches need `harness = false` to have one.
		if (!command || file.modulePath.length > 0 || (crate.kind !== 'bin' && crate.kind !== 'example' && crate.harness)) {
			return undefined;
		}
		return { label: `run ${crate.name}`, cwd: file.packageDir, cargoArgs: [command, ...selection], executableArgs: [] };
	}

	// #[test] functions only run under the test harness.
	if (!crate.harness) {
		return undefined;
	}
	const testPath = [...file.modulePath, ...target.path].join('::');
	const executableArgs =
		target.kind === 'test'
			? [testPath, '--exact', '--nocapture', '--include-ignored']
			: // `tests::` matches every test inside the module, and not a test that only starts with its name.
				[`${testPath}::`, '--nocapture'];
	return { label: `test ${testPath}`, cwd: file.packageDir, cargoArgs: ['test', ...selection], executableArgs };
}

function targetArgs(crate: CrateTarget): string[] {
	return crate.kind === 'lib' ? ['--lib'] : [`--${crate.kind}`, crate.name];
}

/** Checks a value that came in as a command argument. */
export function isRunnable(value: unknown): value is Runnable {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Runnable>;
	const isStringArray = (array: unknown) => Array.isArray(array) && array.every((item) => typeof item === 'string');
	return (
		typeof candidate.label === 'string' &&
		typeof candidate.cwd === 'string' &&
		isStringArray(candidate.cargoArgs) &&
		(candidate.cargoArgs?.length ?? 0) > 0 &&
		isStringArray(candidate.executableArgs)
	);
}

export function runnableToProcess(runnable: Runnable, cargoPath: string): ProcessSpec {
	const args = [...runnable.cargoArgs];
	if (runnable.executableArgs.length > 0) {
		args.push('--', ...runnable.executableArgs);
	}
	return { command: cargoPath, args, cwd: runnable.cwd, env: { RUST_BACKTRACE: 'short', ...NO_AUTO_INSTALL } };
}

/** The command as it would be typed in a terminal, for the button's tooltip. */
export function commandLine(runnable: Runnable): string {
	return ['cargo', ...runnableToProcess(runnable, 'cargo').args].join(' ');
}
