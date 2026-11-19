/**
 * The parts of Cargo.toml that decide which cargo target a .rs file belongs
 * to: the package name, the declared targets ([lib], [[bin]], [[example]],
 * [[test]], [[bench]]) and whether Cargo also finds targets by folder layout
 * (autobins, autoexamples…). Parsed with smol-toml, which ATM already
 * bundles for TOML files; like there, it is imported only when first needed.
 */

export type TargetKind = 'lib' | 'bin' | 'example' | 'test' | 'bench';

export interface TargetDecl {
	name?: string;
	/** Path relative to the package folder, with forward slashes. */
	path?: string;
	requiredFeatures: string[];
	/** false when the target has its own main() instead of the test harness. */
	harness: boolean;
}

export interface CargoManifest {
	/** [package] name; undefined for a Cargo.toml that only defines a workspace. */
	packageName?: string;
	/** The [lib] table, when there is one. */
	lib?: TargetDecl;
	bin: TargetDecl[];
	example: TargetDecl[];
	test: TargetDecl[];
	bench: TargetDecl[];
	/** Whether Cargo adds targets found by folder layout (autolib, autobins, autoexamples, autotests, autobenches). */
	auto: Record<TargetKind, boolean>;
}

const load = () => import('smol-toml');

/** Parses Cargo.toml, or resolves undefined when it is not valid TOML. */
export async function parseCargoManifest(text: string): Promise<CargoManifest | undefined> {
	let data: unknown;
	try {
		const { parse } = await load();
		data = parse(text);
	} catch {
		return undefined;
	}
	const root = asTable(data);
	const pkg = asTable(root.package);
	return {
		packageName: typeof pkg.name === 'string' ? pkg.name : undefined,
		lib: root.lib === undefined ? undefined : readTarget(root.lib),
		bin: readTargets(root.bin),
		example: readTargets(root.example),
		test: readTargets(root.test),
		bench: readTargets(root.bench),
		auto: {
			lib: pkg.autolib !== false,
			bin: pkg.autobins !== false,
			example: pkg.autoexamples !== false,
			test: pkg.autotests !== false,
			bench: pkg.autobenches !== false,
		},
	};
}

const MAX_CACHED = 16;
const cache = new Map<string, Promise<CargoManifest | undefined>>();

/** parseCargoManifest, remembering the last few results because the Run buttons ask on every edit. */
export function readCargoManifest(text: string): Promise<CargoManifest | undefined> {
	let manifest = cache.get(text);
	if (!manifest) {
		manifest = parseCargoManifest(text);
		cache.set(text, manifest);
		if (cache.size > MAX_CACHED) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) {
				cache.delete(oldest);
			}
		}
	}
	return manifest;
}

function asTable(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readTargets(value: unknown): TargetDecl[] {
	return Array.isArray(value) ? value.map(readTarget) : [];
}

function readTarget(value: unknown): TargetDecl {
	const table = asTable(value);
	const features = table['required-features'];
	return {
		name: typeof table.name === 'string' ? table.name : undefined,
		path: typeof table.path === 'string' ? table.path.replace(/\\/g, '/').replace(/^\.\//, '') : undefined,
		requiredFeatures: Array.isArray(features) ? features.filter((feature): feature is string => typeof feature === 'string') : [],
		harness: table.harness !== false,
	};
}
