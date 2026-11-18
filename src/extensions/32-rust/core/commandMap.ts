/**
 * rust-analyzer names the commands behind its buttons and completions
 * `rust-analyzer.*`. ATM answers them under its own names, so it never
 * collides with the rust-analyzer extension's commands.
 */
export const SERVER_COMMANDS: Readonly<Record<string, string>> = {
	'rust-analyzer.runSingle': 'atm.rust.runSingle',
	'rust-analyzer.showReferences': 'atm.rust.showReferences',
	'rust-analyzer.gotoLocation': 'atm.rust.gotoLocation',
	'rust-analyzer.triggerParameterHints': 'atm.rust.triggerParameterHints',
	'rust-analyzer.rename': 'atm.rust.rename',
};

/** Rewrites a command from the server to ATM's name, in place. */
export function renameServerCommand<T extends { command: string }>(command: T | undefined): T | undefined {
	if (command && Object.prototype.hasOwnProperty.call(SERVER_COMMANDS, command.command)) {
		command.command = SERVER_COMMANDS[command.command];
	}
	return command;
}
