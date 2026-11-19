import * as vscode from 'vscode';
import { colorPresentations, findColors, Rgba } from '../core/colors';
import { tokenizeRust } from '../core/lexer';
import { RustTokenCache } from './tokenCache';

/**
 * The colour swatch and picker for Rust, like CSS has: a square before
 * `Color32::from_rgb(10, 130, 20)`, `rgb(0xaef958)`, `"#aef958"`…, and the
 * picker writes the new colour back in the same format and style. Swatches
 * come from the shared token cache, so they add no extra pass over the file.
 */
export class RustColorProvider implements vscode.DocumentColorProvider {
	constructor(private readonly tokens: RustTokenCache) {}

	provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
		return findColors(this.tokens.get(document)).map(
			(match) =>
				new vscode.ColorInformation(
					new vscode.Range(document.positionAt(match.start), document.positionAt(match.end)),
					new vscode.Color(match.color.r, match.color.g, match.color.b, match.color.a),
				),
		);
	}

	/**
	 * Called on every step of a drag in the picker, each one after an edit.
	 * Reading only the lines of the colour keeps a step cheap in a long file;
	 * the whole file is read only when those lines aren't enough (a colour
	 * inside a string that starts on an earlier line).
	 */
	provideColorPresentations(color: vscode.Color, context: { document: vscode.TextDocument; range: vscode.Range }): vscode.ColorPresentation[] {
		const { document, range } = context;
		const picked: Rgba = { r: color.red, g: color.green, b: color.blue, a: color.alpha };
		const original = document.getText(range);
		const start = document.offsetAt(range.start);
		const end = document.offsetAt(range.end);

		const lines = new vscode.Range(range.start.line, 0, range.end.line, document.lineAt(range.end.line).text.length);
		const base = document.offsetAt(lines.start);
		const local = colorPresentations(tokenizeRust(document.getText(lines)), start - base, end - base, original, picked);
		const choices = local.length > 0 ? local : colorPresentations(this.tokens.get(document), start, end, original, picked);

		return choices.map((choice) => {
			const presentation = new vscode.ColorPresentation(choice.label);
			presentation.textEdit = new vscode.TextEdit(range, choice.text);
			return presentation;
		});
	}
}
