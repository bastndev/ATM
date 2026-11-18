import * as vscode from 'vscode';
import { computeFoldingRanges } from '../core/folding';
import { TomlModelCache } from './modelCache';

export class TomlFoldingProvider implements vscode.FoldingRangeProvider {
	constructor(private readonly models: TomlModelCache) {}

	provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
		return computeFoldingRanges(this.models.get(document)).map(
			(range) =>
				new vscode.FoldingRange(
					range.start,
					range.end,
					range.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined,
				),
		);
	}
}
