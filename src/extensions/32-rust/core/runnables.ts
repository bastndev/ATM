/**
 * The ▶ Run / Run Test buttons come from rust-analyzer as "runnables". This
 * turns one into the process to start.
 */

export interface CargoRunnableArgs {
	workspaceRoot?: string;
	cwd: string;
	cargoArgs: string[];
	executableArgs: string[];
	environment?: Record<string, string>;
	overrideCargo?: string;
}

export interface ShellRunnableArgs {
	program: string;
	args: string[];
	cwd: string;
	environment?: Record<string, string>;
}

export interface Runnable {
	label: string;
	kind: 'cargo' | 'shell';
	args: CargoRunnableArgs | ShellRunnableArgs;
}

export interface ProcessSpec {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

export function isRunnable(value: unknown): value is Runnable {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Runnable>;
	if (typeof candidate.label !== 'string' || typeof candidate.args !== 'object' || candidate.args === null) {
		return false;
	}
	if (candidate.kind === 'cargo') {
		return Array.isArray((candidate.args as Partial<CargoRunnableArgs>).cargoArgs);
	}
	return candidate.kind === 'shell' && typeof (candidate.args as Partial<ShellRunnableArgs>).program === 'string';
}

export function runnableToProcess(runnable: Runnable, cargoPath: string): ProcessSpec {
	if (runnable.kind === 'shell') {
		const args = runnable.args as ShellRunnableArgs;
		return { command: args.program, args: [...args.args], cwd: args.cwd, env: { ...args.environment } };
	}
	const args = runnable.args as CargoRunnableArgs;
	let command = cargoPath;
	const commandArgs = [...args.cargoArgs];
	if (args.executableArgs.length > 0) {
		commandArgs.push('--', ...args.executableArgs);
	}
	if (args.overrideCargo) {
		const [program, ...prefix] = args.overrideCargo.split(' ').filter((part) => part.length > 0);
		if (program) {
			command = program;
			commandArgs.unshift(...prefix);
		}
	}
	return {
		command,
		args: commandArgs,
		cwd: args.workspaceRoot || args.cwd,
		env: { RUST_BACKTRACE: 'short', ...args.environment },
	};
}
