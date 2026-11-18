import * as vscode from 'vscode';
import { TomlDiagnostics } from './providers/diagnostics';
import { TomlFoldingProvider } from './providers/folding';
import { TomlModelCache } from './providers/modelCache';
import { TomlOutlineProvider } from './providers/outline';
import { registerConversionCommands } from './ui/commands';

const TOML: vscode.DocumentSelector = { language: 'toml' };

/**
 * TOML support. Colors, comment toggling and bracket pairs are declarative
 * (syntaxes/ + package.json). This adds folding, the outline, syntax errors
 * and TOML ↔ JSON conversion commands.
 */
export function activateToml(context: vscode.ExtensionContext): void {
	const models = new TomlModelCache();
	context.subscriptions.push(
		models,
		vscode.languages.registerFoldingRangeProvider(TOML, new TomlFoldingProvider(models)),
		vscode.languages.registerDocumentSymbolProvider(TOML, new TomlOutlineProvider(models), { label: 'TOML' }),
		new TomlDiagnostics(),
		...registerConversionCommands(),
	);
}
