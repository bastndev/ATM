import * as vscode from 'vscode';
import {
	ClientCapabilities,
	DidChangeConfigurationNotification,
	FeatureState,
	InlayHintRequest,
	LanguageClient,
	LanguageClientOptions,
	NotificationType,
	RequestType,
	RevealOutputChannelOn,
	ServerOptions,
	State,
	StaticFeature,
	TextDocumentPositionParams,
} from 'vscode-languageclient/node';
import { renameServerCommand, SERVER_COMMANDS } from '../core/commandMap';

/** rust-analyzer's own request for the docs.rs / doc.rust-lang.org link of the item under the cursor. */
const EXTERNAL_DOCS = new RequestType<TextDocumentPositionParams, string | { web?: string } | null, void>('experimental/externalDocs');

/** rust-analyzer reports `quiescent: true` once it has finished loading the project. */
const SERVER_STATUS = new NotificationType<{ quiescent?: boolean }>('experimental/serverStatus');

/** For servers that never report their status: treat them as ready after this long. */
const READY_FALLBACK_MS = 120_000;

/**
 * Tells rust-analyzer which of its commands the client can run (turning on
 * the ▶ Run / Run Test buttons and parameter hints after completions), and
 * asks it to report when it has finished loading.
 */
class ServerCommandsFeature implements StaticFeature {
	fillClientCapabilities(capabilities: ClientCapabilities): void {
		capabilities.experimental = {
			...(capabilities.experimental as object | undefined),
			commands: { commands: Object.keys(SERVER_COMMANDS) },
			serverStatusNotification: true,
		};
	}
	initialize(): void {}
	getState(): FeatureState {
		return { kind: 'static' };
	}
	clear(): void {}
}

/**
 * Starts the rust-analyzer program and connects VS Code to it. Everything it
 * offers (completions, hover, go to definition, quick fixes, rename, hints,
 * formatting, errors and Run buttons) arrives through this connection.
 */
export class RustServer implements vscode.Disposable {
	private client: LanguageClient | undefined;
	private loaded = false;
	private readyFallback: ReturnType<typeof setTimeout> | undefined;
	private readonly runningEmitter = new vscode.EventEmitter<boolean>();
	/** Fires when the server starts or stops running, and when it finishes loading. */
	readonly onDidChangeRunning = this.runningEmitter.event;

	constructor(
		private readonly output: vscode.OutputChannel,
		private readonly config: () => Record<string, unknown>,
	) {}

	get isRunning(): boolean {
		return this.client?.state === State.Running;
	}

	/** Running and done loading the project, so its hints and colors are complete. */
	get isReady(): boolean {
		return this.isRunning && this.loaded;
	}

	private markLoaded(): void {
		if (this.readyFallback) {
			clearTimeout(this.readyFallback);
			this.readyFallback = undefined;
		}
		if (!this.loaded) {
			this.loaded = true;
			this.runningEmitter.fire(true);
			this.refreshInlayHints();
		}
	}

	/** Asks VS Code to fetch rust-analyzer's hints again for every open Rust file. */
	private refreshInlayHints(): void {
		const feature = this.client?.getFeature(InlayHintRequest.method);
		for (const document of vscode.workspace.textDocuments) {
			if (document.languageId === 'rust') {
				feature?.getProvider(document)?.onDidChangeInlayHints.fire();
			}
		}
	}

	get languageClient(): LanguageClient | undefined {
		return this.client;
	}

	async start(serverPath: string, cwd: string | undefined): Promise<boolean> {
		await this.stop();

		const serverOptions: ServerOptions = { command: serverPath, options: { cwd } };
		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', language: 'rust' }],
			initializationOptions: this.config(),
			diagnosticCollectionName: 'rust-analyzer',
			outputChannel: this.output,
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			initializationFailedHandler: (error) => {
				this.output.appendLine(`rust-analyzer could not start: ${String(error)}`);
				return false;
			},
			middleware: {
				workspace: {
					configuration: async (params, token, next) => {
						const result = await next(params, token);
						if (!Array.isArray(result)) {
							return result;
						}
						return params.items.map((item, index) => (item.section === 'rust-analyzer' ? this.config() : result[index]));
					},
				},
				// ATM's simple hints cover the loading time; rust-analyzer's take over once it is done.
				provideInlayHints: (document, viewPort, token, next) => (this.loaded ? next(document, viewPort, token) : []),
				provideCodeLenses: async (document, token, next) => {
					const lenses = await next(document, token);
					lenses?.forEach((lens) => renameServerCommand(lens.command));
					return lenses;
				},
				resolveCodeLens: async (lens, token, next) => {
					const resolved = await next(lens, token);
					renameServerCommand(resolved?.command);
					return resolved;
				},
				provideCompletionItem: async (document, position, context, token, next) => {
					const result = await next(document, position, context, token);
					const items = Array.isArray(result) ? result : result?.items;
					items?.forEach((item) => renameServerCommand(item.command));
					return result;
				},
				resolveCompletionItem: async (item, token, next) => {
					const resolved = await next(item, token);
					renameServerCommand(resolved?.command);
					return resolved;
				},
				provideCodeActions: async (document, range, context, token, next) => {
					const actions = await next(document, range, context, token);
					actions?.forEach((action) => {
						if (action instanceof vscode.CodeAction) {
							renameServerCommand(action.command);
						} else {
							renameServerCommand(action);
						}
					});
					return actions;
				},
				resolveCodeAction: async (action, token, next) => {
					const resolved = await next(action, token);
					renameServerCommand(resolved?.command);
					return resolved;
				},
			},
		};

		const client = new LanguageClient('atmRust', 'ATM Rust', serverOptions, clientOptions);
		client.registerFeature(new ServerCommandsFeature());
		client.onDidChangeState((event) => {
			if (this.client !== client) {
				return;
			}
			if (event.newState === State.Running) {
				this.readyFallback = setTimeout(() => this.markLoaded(), READY_FALLBACK_MS);
			} else {
				this.loaded = false;
			}
			this.runningEmitter.fire(event.newState === State.Running);
		});
		client.onNotification(SERVER_STATUS, (status) => {
			if (this.client === client && status.quiescent) {
				this.markLoaded();
			}
		});
		this.loaded = false;
		this.client = client;

		try {
			await client.start();
			return true;
		} catch (error) {
			this.output.appendLine(`rust-analyzer stopped: ${String(error)}`);
			if (this.client === client) {
				this.client = undefined;
				this.runningEmitter.fire(false);
			}
			return false;
		}
	}

	async stop(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		this.loaded = false;
		if (this.readyFallback) {
			clearTimeout(this.readyFallback);
			this.readyFallback = undefined;
		}
		if (!client) {
			return;
		}
		try {
			if (client.isRunning()) {
				await client.stop();
			}
			await client.dispose();
		} catch {
			// Already stopped.
		}
		this.runningEmitter.fire(false);
	}

	/** rust-analyzer asks for the settings again after this. */
	notifyConfigChanged(): void {
		if (this.isRunning) {
			void this.client?.sendNotification(DidChangeConfigurationNotification.type, { settings: null });
		}
	}

	async externalDocs(document: vscode.TextDocument, position: vscode.Position): Promise<string | undefined> {
		const client = this.client;
		if (!client || !this.isRunning) {
			return undefined;
		}
		const params: TextDocumentPositionParams = {
			textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document),
			position: client.code2ProtocolConverter.asPosition(position),
		};
		const result = await client.sendRequest(EXTERNAL_DOCS, params);
		const url = typeof result === 'string' ? result : result?.web;
		return url && url.length > 0 ? url : undefined;
	}

	dispose(): void {
		void this.stop();
		this.runningEmitter.dispose();
	}
}
