import { NO_AUTO_INSTALL } from '../../32-rust/core/rustup';

/**
 * The environment a program gets from `cargo run`, rebuilt here because
 * Cargo Run starts the built executable itself (that's what lets the old
 * window stay open while a new build is checked). Without it, programs that
 * read CARGO_MANIFEST_DIR at runtime (Bevy finds its assets that way) or
 * that link libraries dynamically (Bevy's `dynamic_linking`) would behave
 * differently than in a terminal.
 */

export interface AppEnvironmentOptions {
	base: Readonly<Record<string, string | undefined>>;
	platform: NodeJS.Platform;
	/** Path of the cargo command, for CARGO. */
	cargo: string;
	pkg: { name: string; version: string; manifestPath: string; dir: string };
	/** Folders searched for shared libraries, most important first. */
	libraryDirs: readonly string[];
	/** Home folder, for macOS's default library folders. */
	home: string;
}

type Environment = Record<string, string>;

export function appEnvironment(options: AppEnvironmentOptions): Environment {
	const env: Environment = {};
	for (const [key, value] of Object.entries(options.base)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}
	Object.assign(env, NO_AUTO_INSTALL, {
		CARGO: options.cargo,
		CARGO_MANIFEST_DIR: options.pkg.dir,
		CARGO_MANIFEST_PATH: options.pkg.manifestPath,
		CARGO_PKG_NAME: options.pkg.name,
		CARGO_PKG_VERSION: options.pkg.version,
		...versionParts(options.pkg.version),
	});
	addLibraryDirs(env, options);
	return env;
}

/** The variable the system searches for shared libraries, as cargo sets it. */
export function libraryPathVariable(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'PATH' : platform === 'darwin' ? 'DYLD_FALLBACK_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
}

function addLibraryDirs(env: Environment, options: AppEnvironmentOptions): void {
	const name = libraryPathVariable(options.platform);
	const separator = options.platform === 'win32' ? ';' : ':';
	// Windows keeps the variable as "Path"; writing a second "PATH" would hide the real one.
	const key = options.platform === 'win32' ? (Object.keys(env).find((existing) => existing.toUpperCase() === name) ?? name) : name;
	const current = env[key]?.split(separator).filter((dir) => dir.length > 0) ?? [];
	if (current.length === 0 && options.platform === 'darwin') {
		// Setting the variable replaces macOS's defaults, so cargo adds them back.
		current.push(`${options.home}/lib`, '/usr/local/lib', '/usr/lib');
	}
	const dirs = [...options.libraryDirs, ...current].filter((dir, index, all) => all.indexOf(dir) === index);
	env[key] = dirs.join(separator);
}

function versionParts(version: string): Environment {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]*))?/.exec(version);
	if (!match) {
		return {};
	}
	return {
		CARGO_PKG_VERSION_MAJOR: match[1],
		CARGO_PKG_VERSION_MINOR: match[2],
		CARGO_PKG_VERSION_PATCH: match[3],
		CARGO_PKG_VERSION_PRE: match[4] ?? '',
	};
}
