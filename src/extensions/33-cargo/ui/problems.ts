import * as vscode from 'vscode';
import { Problem, ProblemSeverity } from '../core/problems';
import { ProblemSink } from '../host/runner';

const SEVERITIES: Record<ProblemSeverity, vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

/** The last build's errors and warnings, underlined in the editor and listed in the Problems panel. */
export class ProblemsPanel implements ProblemSink, vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection('atm-cargo');

	set(problems: Problem[]): void {
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const problem of problems) {
			const range = new vscode.Range(problem.line, problem.column, problem.endLine, problem.endColumn);
			const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITIES[problem.severity]);
			diagnostic.source = 'rustc';
			diagnostic.code = problem.code;
			const list = byFile.get(problem.file) ?? [];
			list.push(diagnostic);
			byFile.set(problem.file, list);
		}
		this.collection.clear();
		this.collection.set([...byFile].map(([file, diagnostics]) => [vscode.Uri.file(file), diagnostics]));
	}

	clear(): void {
		this.collection.clear();
	}

	dispose(): void {
		this.collection.dispose();
	}
}
