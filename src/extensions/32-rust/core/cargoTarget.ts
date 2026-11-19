import * as path from 'path';
import { CargoManifest, readCargoManifest, TargetDecl, TargetKind } from './cargoManifest';
import { tokenizeRust } from './lexer';
import { topLevelModules } from './runTargets';

/**
 * Which cargo target (library, binary, example, test or bench) a .rs file
 * belongs to, and the file's module path inside that crate. It follows
 * Cargo's folder layout (src/main.rs, src/lib.rs, src/bin/, examples/,
 * tests/, benches/) and the targets declared in Cargo.toml, so a Run button
 * can pass `--bin`, `--lib`, `--example`… without rust-analyzer.
 */

export interface CrateTarget {
	kind: TargetKind;
	/** Target name; the package name for the library. */
	name: string;
	requiredFeatures: string[];
	/** false when the target has its own main() instead of the test harness. */
	harness: boolean;
}

export interface FileTarget {
	packageName: string;
	/** Folder holding the package's Cargo.toml. */
	packageDir: string;
	target: CrateTarget;
	/** Module path in the crate: [] for the crate root, ['utils', 'math'] for src/utils/math.rs. */
	modulePath: string[];
}

/** How project files are read: the editor passes unsaved text, tests pass an in-memory project. */
export interface ProjectFiles {
	/** The file's text, or undefined when it does not exist. */
	read(file: string): Promise<string | undefined>;
}

interface Package {
	dir: string;
	name: string;
	manifest: CargoManifest;
}

/** A crate root, relative to the package folder, and the target it starts. */
interface Root {
	file: string;
	target: CrateTarget;
}

/** Folders where each .rs file, or each subfolder with a main.rs, is a target of its own. */
const LAYOUT_DIRS: ReadonlyArray<readonly [string, Exclude<TargetKind, 'lib'>]> = [
	['src/bin', 'bin'],
	['examples', 'example'],
	['tests', 'test'],
	['benches', 'bench'],
];

const DECLARED_KINDS: ReadonlyArray<Exclude<TargetKind, 'lib'>> = ['bin', 'example', 'test', 'bench'];

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The target and module path of `file`, or undefined when no Cargo package compiles it. */
export async function findFileTarget(file: string, files: ProjectFiles): Promise<FileTarget | undefined> {
	const pkg = await findPackage(path.dirname(file), files);
	if (!pkg) {
		return undefined;
	}
	const rel = path.relative(pkg.dir, file).split(path.sep).join('/');
	const roots = await rootsFor(rel, pkg, files);

	const own = roots.find((root) => root.file === rel);
	if (own) {
		return { packageName: pkg.name, packageDir: pkg.dir, target: own.target, modulePath: [] };
	}

	// A module file belongs to the nearest crate root whose folder holds it and that declares
	// its top module. When src/lib.rs and src/main.rs both could, the library is tried first.
	const candidates = roots
		.map((root) => {
			const base = path.posix.dirname(root.file);
			return { root, depth: base === '.' ? 0 : base.split('/').length, modulePath: modulePathFrom(base, rel) };
		})
		.filter((candidate) => candidate.modulePath !== undefined)
		.sort((a, b) => b.depth - a.depth);
	for (const { root, modulePath } of candidates) {
		if (modulePath && (await declaresModule(path.join(pkg.dir, ...root.file.split('/')), modulePath[0], files))) {
			return { packageName: pkg.name, packageDir: pkg.dir, target: root.target, modulePath };
		}
	}
	return undefined;
}

/** The nearest Cargo.toml above `start` that defines a package. */
async function findPackage(start: string, files: ProjectFiles): Promise<Package | undefined> {
	let dir = start;
	for (;;) {
		const text = await files.read(path.join(dir, 'Cargo.toml'));
		if (text !== undefined) {
			// A workspace-only Cargo.toml has no package, so files next to it are in no crate.
			const manifest = await readCargoManifest(text);
			return manifest?.packageName ? { dir, name: manifest.packageName, manifest } : undefined;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

/** The crate roots that could compile the file at `rel`. */
async function rootsFor(rel: string, pkg: Package, files: ProjectFiles): Promise<Root[]> {
	const { manifest } = pkg;
	const exists = async (file: string) => (await files.read(path.join(pkg.dir, ...file.split('/')))) !== undefined;
	const roots: Root[] = [];
	const known = (file: string) => roots.some((root) => root.file === file);

	const libFile = manifest.lib?.path ?? 'src/lib.rs';
	if ((manifest.lib || manifest.auto.lib) && (await exists(libFile))) {
		roots.push({ file: libFile, target: crateTarget('lib', pkg.name, manifest.lib) });
	}

	for (const kind of DECLARED_KINDS) {
		for (const decl of manifest[kind]) {
			if (decl.path && decl.name && !known(decl.path)) {
				roots.push({ file: decl.path, target: crateTarget(kind, decl.name, decl) });
			}
		}
	}

	// src/main.rs is the binary named after the package.
	if (!known('src/main.rs') && (await exists('src/main.rs'))) {
		const decl = manifest.bin.find((bin) => !bin.path && bin.name === pkg.name);
		if (manifest.auto.bin || decl) {
			roots.push({ file: 'src/main.rs', target: crateTarget('bin', pkg.name, decl) });
		}
	}

	// src/bin/tool.rs or src/bin/tool/main.rs is the binary `tool`; the same for examples, tests and benches.
	for (const [dir, kind] of LAYOUT_DIRS) {
		if (!rel.startsWith(dir + '/')) {
			continue;
		}
		const rest = rel.slice(dir.length + 1).split('/');
		if (rest.length === 1 && !rest[0].endsWith('.rs')) {
			continue;
		}
		const name = rest.length === 1 ? rest[0].slice(0, -3) : rest[0];
		const file = rest.length === 1 ? rel : `${dir}/${name}/main.rs`;
		const decl = manifest[kind].find((target) => !target.path && target.name === name);
		if (known(file) || (!manifest.auto[kind] && !decl) || (rest.length > 1 && !(await exists(file)))) {
			continue;
		}
		roots.push({ file, target: crateTarget(kind, name, decl) });
	}
	return roots;
}

function crateTarget(kind: TargetKind, name: string, decl: TargetDecl | undefined): CrateTarget {
	return { kind, name, requiredFeatures: decl?.requiredFeatures ?? [], harness: decl?.harness ?? true };
}

/** `src/utils/math.rs` from base `src` is ['utils', 'math']; undefined when the file can't be a module there. */
function modulePathFrom(base: string, rel: string): string[] | undefined {
	const prefix = base === '.' ? '' : base + '/';
	if (!rel.startsWith(prefix) || !rel.endsWith('.rs')) {
		return undefined;
	}
	const parts = rel.slice(prefix.length, -3).split('/');
	if (parts[parts.length - 1] === 'mod') {
		parts.pop();
	}
	return parts.length > 0 && parts.every((part) => IDENTIFIER.test(part)) ? parts : undefined;
}

const MAX_CACHED = 16;
const moduleCache = new Map<string, Set<string>>();

async function declaresModule(rootFile: string, name: string, files: ProjectFiles): Promise<boolean> {
	const text = await files.read(rootFile);
	if (text === undefined) {
		return false;
	}
	let names = moduleCache.get(text);
	if (!names) {
		names = topLevelModules(tokenizeRust(text));
		moduleCache.set(text, names);
		if (moduleCache.size > MAX_CACHED) {
			const oldest = moduleCache.keys().next().value;
			if (oldest !== undefined) {
				moduleCache.delete(oldest);
			}
		}
	}
	return names.has(name);
}
