import * as fs from 'fs/promises';
import * as path from 'path';
import type { ResolvedConfig } from './types';

async function validateJsonConfig(configPath: string): Promise<void> {
	const isPackage = path.basename(configPath) === 'package.json';
	if (!isPackage && !['.prettierrc', '.prettierrc.json'].includes(path.basename(configPath))) { return; }
	const content = (await fs.readFile(configPath, 'utf-8')).replace(/^\uFEFF/, '');
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch (error) {
		// A bare .prettierrc can contain YAML; let Prettier validate that format.
		if (path.basename(configPath) === '.prettierrc' && !content.trimStart().startsWith('{')) { return; }
		throw error;
	}
	if (isPackage) { value = (value as Record<string, unknown>)?.prettier; }
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected a configuration object');
	}
}

async function validatePackageFiles(filePath: string, configPath: string | null): Promise<void> {
	let directory = path.dirname(filePath);
	const stop = configPath ? path.dirname(configPath) : undefined;
	while (true) {
		const packagePath = path.join(directory, 'package.json');
		try {
			const value: unknown = JSON.parse((await fs.readFile(packagePath, 'utf-8')).replace(/^\uFEFF/, ''));
			if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Expected a package object'); }
			if (Object.hasOwn(value, 'prettier')) { await validateJsonConfig(packagePath); }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw new Error(packagePath + ': ' + (error instanceof Error ? error.message : String(error)));
			}
		}
		if (directory === stop) { break; }
		const parent = path.dirname(directory);
		if (parent === directory) { break; }
		directory = parent;
	}
}

/** Native Prettier discovery and per-file overrides; executable config needs workspace trust. */
export async function resolveConfigForFile(filePath: string, trusted: boolean): Promise<ResolvedConfig> {
	if (!trusted) { return { config: null, configPath: null }; }
	let configPath: string | null = null;
	try {
		const prettier = await import('prettier');
		configPath = await prettier.resolveConfigFile(filePath);
		await validatePackageFiles(filePath, configPath);
		if (configPath) { await validateJsonConfig(configPath); }
		const config = await prettier.resolveConfig(filePath, { editorconfig: true, useCache: false });
		return { config, configPath };
	} catch (error) {
		throw new Error('Invalid configuration at ' + (configPath ?? filePath) + ': ' + (error instanceof Error ? error.message : String(error)));
	}
}
