import * as vscode from 'vscode';
import { scanToml, TomlModel } from '../core/scanner';

const MAX_ENTRIES = 20;

/**
 * Folding, the outline, breadcrumbs and sticky scroll all ask for the same
 * document after every edit, so the scan is cached per document version.
 */
export class TomlModelCache implements vscode.Disposable {
	private readonly models = new Map<string, { version: number; model: TomlModel }>();
	private readonly closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
		this.models.delete(document.uri.toString());
	});

	get(document: vscode.TextDocument): TomlModel {
		const key = document.uri.toString();
		const cached = this.models.get(key);
		if (cached && cached.version === document.version) {
			return cached.model;
		}
		const model = scanToml(document.getText());
		this.models.delete(key);
		this.models.set(key, { version: document.version, model });
		if (this.models.size > MAX_ENTRIES) {
			const oldest = this.models.keys().next().value;
			if (oldest !== undefined) {
				this.models.delete(oldest);
			}
		}
		return model;
	}

	dispose(): void {
		this.closeListener.dispose();
		this.models.clear();
	}
}
