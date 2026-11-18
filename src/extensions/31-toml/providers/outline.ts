import * as vscode from 'vscode';
import { buildOutline, OutlineKind, OutlineNode } from '../core/outline';
import { Span } from '../core/scanner';
import { TomlModelCache } from './modelCache';

const SYMBOL_KINDS: Record<OutlineKind, vscode.SymbolKind> = {
	table: vscode.SymbolKind.Object,
	arrayTable: vscode.SymbolKind.Array,
	inlineTable: vscode.SymbolKind.Object,
	array: vscode.SymbolKind.Array,
	string: vscode.SymbolKind.String,
	number: vscode.SymbolKind.Number,
	boolean: vscode.SymbolKind.Boolean,
	datetime: vscode.SymbolKind.Field,
	invalid: vscode.SymbolKind.Null,
};

/** Feeds the Outline view, breadcrumbs, Go to Symbol (Ctrl+Shift+O) and sticky scroll. */
export class TomlOutlineProvider implements vscode.DocumentSymbolProvider {
	constructor(private readonly models: TomlModelCache) {}

	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		return buildOutline(this.models.get(document)).map((node) => toSymbol(document, node));
	}
}

function toSymbol(document: vscode.TextDocument, node: OutlineNode): vscode.DocumentSymbol {
	const symbol = new vscode.DocumentSymbol(
		node.name || "''",
		node.detail,
		SYMBOL_KINDS[node.kind],
		toRange(document, node.range),
		toRange(document, node.selectionRange),
	);
	symbol.children = node.children.map((child) => toSymbol(document, child));
	return symbol;
}

function toRange(document: vscode.TextDocument, span: Span): vscode.Range {
	return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
}
