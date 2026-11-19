import * as vscode from 'vscode';
import { CheckController } from './host/checkController';
import { registerCargoCommands } from './host/commands';
import { CargoController } from './host/controller';
import { CargoProjects } from './host/projects';
import { ProblemsPanel } from './ui/problems';

/**
 * Cargo Run: start a Rust program with ▶ (or Alt+G), rebuild it with
 * Ctrl+G, and stop it with ■ (or Alt+G again). A rebuild only replaces the
 * running program when the new code compiles; otherwise the old one keeps
 * running and the errors are shown. Only one copy runs at a time.
 *
 * The save check: `cargo check` after each save and after a cargo command
 * typed in a terminal, so errors are underlined without pressing Run.
 * Both report to the same Problems collection. See PLAN.md for the design.
 */
export function activateCargo(context: vscode.ExtensionContext): void {
	const projects = new CargoProjects();
	const problems = new ProblemsPanel();
	const controller = new CargoController(context.workspaceState, projects, problems);
	const checks = new CheckController(projects, problems, controller);
	context.subscriptions.push(checks, controller, ...registerCargoCommands(controller), problems, projects);
}
