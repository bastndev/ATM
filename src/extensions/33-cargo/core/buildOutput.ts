/**
 * Reads what `cargo build --message-format=json-diagnostic-rendered-ansi`
 * prints on stdout: one JSON object per line.
 *
 * - `compiler-message` holds an error or warning, with the coloured text the
 *   terminal would show in `message.rendered`.
 * - `compiler-artifact` names a finished file; for a program, `executable`
 *   is the path to start.
 * - `build-finished` says whether the build worked.
 *
 * cargo's own lines (Compiling…, Finished…) go to stderr and are shown as
 * they come.
 */

export interface Artifact {
	executable: string;
	/** Target kinds, such as ["bin"] or ["example"]. */
	kind: string[];
	name: string;
	/** True for test builds, which also have an executable. */
	test: boolean;
}

export type BuildEvent =
	| { type: 'text'; text: string }
	| { type: 'message'; rendered: string | undefined; message: unknown }
	| { type: 'artifact'; artifact: Artifact }
	| { type: 'finished'; success: boolean };

/** Joins stdout chunks into whole lines; a JSON object can be split across chunks. */
export class LineSplitter {
	private rest = '';

	push(chunk: string): string[] {
		const lines = (this.rest + chunk).split('\n');
		this.rest = lines.pop() ?? '';
		return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
	}

	/** The last line, when the output didn't end with a newline. */
	end(): string[] {
		const rest = this.rest;
		this.rest = '';
		return rest.length > 0 ? [rest] : [];
	}
}

/** One stdout line as an event; undefined for JSON that Cargo Run doesn't use (build scripts…). */
export function parseBuildLine(line: string): BuildEvent | undefined {
	if (!line.startsWith('{')) {
		return { type: 'text', text: line };
	}
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return { type: 'text', text: line };
	}
	switch (data.reason) {
		case 'compiler-message': {
			const message = data.message as Record<string, unknown> | undefined;
			return { type: 'message', rendered: typeof message?.rendered === 'string' ? message.rendered : undefined, message };
		}
		case 'compiler-artifact': {
			const target = (data.target ?? {}) as Record<string, unknown>;
			const profile = (data.profile ?? {}) as Record<string, unknown>;
			if (typeof data.executable !== 'string' || typeof target.name !== 'string') {
				return undefined;
			}
			const kind = Array.isArray(target.kind) ? target.kind.filter((item): item is string => typeof item === 'string') : [];
			return { type: 'artifact', artifact: { executable: data.executable, kind, name: target.name, test: profile.test === true } };
		}
		case 'build-finished':
			return { type: 'finished', success: data.success === true };
		default:
			return undefined;
	}
}

/** The executable of the program that was built, out of everything the build produced. */
export function pickExecutable(artifacts: readonly Artifact[], program: { kind: string; name: string }): string | undefined {
	return artifacts.find((artifact) => !artifact.test && artifact.name === program.name && artifact.kind.includes(program.kind))?.executable;
}
