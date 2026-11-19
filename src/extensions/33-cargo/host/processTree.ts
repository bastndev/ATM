import { ChildProcess, spawn } from 'child_process';

/**
 * Starts processes so that the whole tree can be stopped later. A GUI app
 * or cargo itself starts children (rustc, helpers, renderers), and
 * `child.kill()` would stop only the first one. On Linux and macOS the
 * process leads its own process group, and the group gets the signal. On
 * Windows `taskkill /T` walks the tree.
 */

const isWindows = process.platform === 'win32';
/** How long a program gets to close by itself before it is killed. */
const GRACE_MS = 2000;
/** After a forced kill, how long to wait for the exit event. */
const KILL_WAIT_MS = 1000;

export interface SpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export function spawnTree(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.env,
		detached: !isWindows,
		windowsHide: true,
		stdio: 'pipe',
	});
	child.stdout?.setEncoding('utf8');
	child.stderr?.setEncoding('utf8');
	// Writing to a program that already exited fails; that is not an error worth reporting.
	child.stdin?.on('error', () => undefined);
	return child;
}

export function isRunning(child: ChildProcess): boolean {
	return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** Asks the tree to close, kills it if it doesn't, and resolves once the process has exited. */
export function stopTree(child: ChildProcess, graceMs = GRACE_MS): Promise<void> {
	const pid = child.pid;
	if (pid === undefined || !isRunning(child)) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = () => {
			clearTimeout(timer);
			child.off('exit', done);
			resolve();
		};
		child.once('exit', done);
		if (isWindows) {
			killWindowsTree(pid, child);
			timer = setTimeout(done, graceMs);
		} else {
			signalGroup(pid, 'SIGTERM');
			timer = setTimeout(() => {
				signalGroup(pid, 'SIGKILL');
				timer = setTimeout(done, KILL_WAIT_MS);
			}, graceMs);
		}
	});
}

/** Stops the tree without waiting, for when the editor closes. */
export function stopTreeNow(child: ChildProcess): void {
	const pid = child.pid;
	if (pid === undefined || !isRunning(child)) {
		return;
	}
	if (isWindows) {
		killWindowsTree(pid, child);
	} else {
		signalGroup(pid, 'SIGTERM');
	}
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		// A negative pid sends the signal to the whole process group.
		process.kill(-pid, signal);
	} catch {
		// The group is already gone.
	}
}

function killWindowsTree(pid: number, child: ChildProcess): void {
	const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
	taskkill.on('error', () => child.kill());
}
