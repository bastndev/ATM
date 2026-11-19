import * as path from 'path';

/**
 * Reads the output of `cargo metadata --no-deps --format-version 1`: the
 * workspace folder, the folder builds go to and, for each package, the
 * programs it can start (binaries and examples). Cargo works all of this
 * out itself, including workspace member globs and auto-discovered
 * binaries, so ATM never has to guess.
 */

export type ProgramKind = 'bin' | 'example';

export interface Program {
	kind: ProgramKind;
	name: string;
	/** The program's main file, absolute. */
	srcPath: string;
	requiredFeatures: string[];
}

export interface CargoPackage {
	id: string;
	name: string;
	version: string;
	manifestPath: string;
	/** Folder holding the package's Cargo.toml. */
	dir: string;
	/** `default-run` from [package]: the binary `cargo run` picks when there are several. */
	defaultRun?: string;
	programs: Program[];
}

export interface CargoWorkspace {
	/** The folder with the top Cargo.toml, where `cargo run` is usually typed. */
	root: string;
	/** `target/`, or wherever CARGO_TARGET_DIR / build.target-dir points. */
	targetDir: string;
	packages: CargoPackage[];
	/** Ids of the packages `cargo run` looks at without --package (default-members). */
	defaultMembers: string[];
}

/** Parses cargo metadata's JSON, or returns undefined when it isn't what cargo prints. */
export function parseMetadata(json: string): CargoWorkspace | undefined {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return undefined;
	}
	const root = asObject(data);
	if (typeof root.workspace_root !== 'string' || typeof root.target_directory !== 'string' || !Array.isArray(root.packages)) {
		return undefined;
	}
	const members = new Set(stringArray(root.workspace_members));
	const packages = root.packages.map(readPackage).filter((pkg): pkg is CargoPackage => pkg !== undefined && members.has(pkg.id));
	// workspace_default_members exists since cargo 1.71; before that every member is a default one.
	const defaults = Array.isArray(root.workspace_default_members) ? stringArray(root.workspace_default_members) : [...members];
	return { root: root.workspace_root, targetDir: root.target_directory, packages, defaultMembers: defaults };
}

function readPackage(value: unknown): CargoPackage | undefined {
	const pkg = asObject(value);
	if (typeof pkg.id !== 'string' || typeof pkg.name !== 'string' || typeof pkg.manifest_path !== 'string') {
		return undefined;
	}
	const programs = Array.isArray(pkg.targets) ? pkg.targets.map(readProgram).filter((program): program is Program => program !== undefined) : [];
	return {
		id: pkg.id,
		name: pkg.name,
		version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
		manifestPath: pkg.manifest_path,
		dir: path.dirname(pkg.manifest_path),
		defaultRun: typeof pkg.default_run === 'string' ? pkg.default_run : undefined,
		programs,
	};
}

function readProgram(value: unknown): Program | undefined {
	const target = asObject(value);
	const kinds = stringArray(target.kind);
	if (typeof target.name !== 'string' || typeof target.src_path !== 'string') {
		return undefined;
	}
	// An example can also be a library (crate-type = ["lib"]); only one built as a program runs.
	const kind: ProgramKind | undefined = kinds.includes('bin')
		? 'bin'
		: kinds.includes('example') && stringArray(target.crate_types).includes('bin')
			? 'example'
			: undefined;
	if (!kind) {
		return undefined;
	}
	return { kind, name: target.name, srcPath: target.src_path, requiredFeatures: stringArray(target['required-features']) };
}

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
