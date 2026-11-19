import * as vscode from 'vscode';
import { registerCargoCommands } from './host/commands';
import { CargoController } from './host/controller';

/**
 * Cargo Run: start a Rust program with ▶ (or Alt+G), rebuild it with
 * Ctrl+G, and stop it with ■ (or Alt+G again). A rebuild only replaces the
 * running program when the new code compiles; otherwise the old one keeps
 * running and the errors are shown. Only one copy runs at a time.
 * See PLAN.md for the design.
 */
export function activateCargo(context: vscode.ExtensionContext): void {
	const controller = new CargoController(context.workspaceState);
	context.subscriptions.push(controller, ...registerCargoCommands(controller));
}
