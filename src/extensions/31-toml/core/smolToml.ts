/**
 * smol-toml ships as an ES module, so it is loaded with a dynamic import
 * (a static import is rejected by TypeScript in this CommonJS project).
 * esbuild still bundles it; the import also keeps it off the activation path
 * until a TOML document needs it.
 */
const load = () => import('smol-toml');

export type SmolToml = Awaited<ReturnType<typeof load>>;

let loading: Promise<SmolToml> | undefined;

export function loadSmolToml(): Promise<SmolToml> {
	loading ??= load();
	return loading;
}

export interface TomlSyntaxError {
	/** One-based line. */
	line: number;
	/** One-based column. */
	column: number;
	message: string;
}

/** Turns a smol-toml error into a line, column and a short message. */
export function toSyntaxError(error: unknown): TomlSyntaxError {
	const err = error as { line?: unknown; column?: unknown; message?: unknown };
	const line = typeof err.line === 'number' ? err.line : 1;
	const column = typeof err.column === 'number' ? err.column : 1;
	// smol-toml messages look like "Invalid TOML document: <reason>\n\n<code excerpt>".
	const reason = String(err.message ?? error)
		.replace(/^Invalid TOML document:\s*/, '')
		.split('\n')[0]
		.trim();
	return { line, column, message: reason.charAt(0).toUpperCase() + reason.slice(1) };
}
