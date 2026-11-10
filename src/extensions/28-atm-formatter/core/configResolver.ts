import * as fs from 'fs';
import * as path from 'path';
import type { FormatterConfig, ResolvedConfig } from './types';

/**
 * Resolves Prettier configuration for a given file path.
 *
 * This is a lightweight implementation that supports JSON-based config
 * files (`.prettierrc`, `.prettierrc.json`, `package.json` `prettier` key).
 * JS/TS/YAML/TOML config support can be added later by extending
 * `CONFIG_FILENAMES` and the `loadConfigFile` switch.
 *
 * Walks up from the file's directory until a config is found or the
 * workspace root is reached.
 */

const CONFIG_FILENAMES = [
	'.prettierrc',
	'.prettierrc.json',
] as const;

function readJsonObject(filePath: string): Record<string, unknown> {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error('Expected a JSON object');
		}
		return value as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Invalid configuration at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function loadPrettierFromPackageJson(pkgPath: string): FormatterConfig | null {
	const pkg = readJsonObject(pkgPath);
	if (!Object.hasOwn(pkg, 'prettier')) { return null; }
	if (!pkg.prettier || typeof pkg.prettier !== 'object' || Array.isArray(pkg.prettier)) {
		throw new Error(`Invalid configuration at ${pkgPath}: the "prettier" field must be a JSON object. Shared configuration packages are not supported yet.`);
	}
	return pkg.prettier as FormatterConfig;
}

/**
 * Walks up from `startDir` looking for a Prettier config file.
 * Stops at `rootDir` (inclusive).
 */
function findConfigFile(startDir: string, rootDir: string): string | null {
	let dir = startDir;
	while (true) {
		for (const name of CONFIG_FILENAMES) {
			const candidate = path.join(dir, name);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
		// Check package.json prettier key
		const pkgPath = path.join(dir, 'package.json');
		if (fs.existsSync(pkgPath)) {
			if (loadPrettierFromPackageJson(pkgPath) !== null) { return pkgPath; }
		}

		if (path.resolve(dir) === path.resolve(rootDir)) {
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return null;
}

/** Load a config from a resolved path (supports .prettierrc/.json + package.json). */
function loadConfigFromPath(configPath: string): FormatterConfig | null {
	const base = path.basename(configPath);
	if (base === 'package.json') {
		return loadPrettierFromPackageJson(configPath);
	}
	return readJsonObject(configPath) as FormatterConfig;
}

/**
 * Resolve the Prettier config for a document at `filePath`, walking up
 * from the file's directory to `workspaceRoot`.
 *
 * @returns `{ config: null, configPath: null }` when no config is found.
 */
export function resolveConfigForFile(
	filePath: string,
	workspaceRoot: string,
): ResolvedConfig {
	const startDir = path.dirname(filePath);
	const configPath = findConfigFile(startDir, workspaceRoot);
	if (!configPath) {
		return { config: null, configPath: null };
	}
	const config = loadConfigFromPath(configPath);
	return { config, configPath };
}
