/**
 * The rust-analyzer program reads its settings from the client. ATM keeps
 * its own short list of settings and sends this object for the
 * "rust-analyzer" section; everything else stays at the program's defaults.
 */

export interface RustSettings {
	checkCommand: 'check' | 'clippy';
	typeHints: boolean;
	parameterHints: boolean;
}

export function buildServerConfig(settings: RustSettings): Record<string, unknown> {
	return {
		checkOnSave: true,
		check: { command: settings.checkCommand },
		inlayHints: {
			typeHints: { enable: settings.typeHints },
			chainingHints: { enable: settings.typeHints },
			parameterHints: { enable: settings.parameterHints },
			closingBraceHints: { enable: false },
		},
		// Only the ▶ Run / Run Test buttons.
		lens: {
			enable: true,
			run: { enable: true },
			debug: { enable: false },
			implementations: { enable: false },
			updateTest: { enable: false },
		},
		hover: { actions: { enable: false } },
	};
}
