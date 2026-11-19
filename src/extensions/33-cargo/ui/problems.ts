import * as vscode from 'vscode';
import { Problem, ProblemSeverity, ProblemSink } from '../core/problems';

const SEVERITIES: Record<ProblemSeverity, vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

/**
 * The compiler's latest errors and warnings, underlined in the editor and
 * listed in the Problems panel. Cargo Run's builds, the save check and cargo
 * commands typed in a terminal all report here, one Cargo workspace at a
 * time: a new report replaces only that workspace's problems.
 *
 * A file whose problems didn't change is left alone, so a save that fixes
 * nothing doesn't make the Problems panel or Error Lens redraw.
 */
export class ProblemsPanel implements ProblemSink, vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection('atm-cargo');
	/** Workspace root → file → that file's problems, as the workspace last reported them. */
	private readonly byRoot = new Map<string, Map<string, Problem[]>>();
	/** What each file shows now, as a comparable string. */
	private readonly shown = new Map<string, string>();

	set(root: string, problems: Problem[]): void {
		const files = new Map<string, Problem[]>();
		for (const problem of problems) {
			const list = files.get(problem.file) ?? [];
			list.push(problem);
			files.set(problem.file, list);
		}
		const touched = new Set([...(this.byRoot.get(root)?.keys() ?? []), ...files.keys()]);
		if (files.size > 0) {
			this.byRoot.set(root, files);
		} else {
			this.byRoot.delete(root);
		}
		touched.forEach((file) => this.render(file));
	}

	/** A file can belong to two workspaces (a path dependency); it shows the problems of both. */
	private render(file: string): void {
		const problems = [...this.byRoot.values()].flatMap((files) => files.get(file) ?? []);
		const uri = vscode.Uri.file(file);
		if (problems.length === 0) {
			if (this.shown.delete(file)) {
				this.collection.delete(uri);
			}
			return;
		}
		const signature = JSON.stringify(problems);
		if (this.shown.get(file) === signature) {
			return;
		}
		this.shown.set(file, signature);
		this.collection.set(uri, problems.map(toDiagnostic));
	}

	dispose(): void {
		this.collection.dispose();
	}
}

function toDiagnostic(problem: Problem): vscode.Diagnostic {
	const range = new vscode.Range(problem.line, problem.column, problem.endLine, problem.endColumn);
	const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITIES[problem.severity]);
	diagnostic.source = 'rustc';
	diagnostic.code = problem.code;
	return diagnostic;
}
