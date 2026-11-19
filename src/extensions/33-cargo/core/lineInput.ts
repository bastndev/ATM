/**
 * Typing into the Cargo Run terminal. The program reads a pipe, not a real
 * terminal, so nothing echoes the keys or handles Backspace. This does what
 * a terminal's line mode does: shows what is typed, lets Backspace fix it,
 * and sends the line when Enter is pressed. Arrow keys and other escape
 * sequences are ignored.
 */

export interface LineInputResult {
	/** Text to show in the terminal. */
	echo: string;
	/** Finished lines for the program, each ending with \n. */
	lines: string[];
	/** Ctrl+D on an empty line: the program's input should be closed. */
	end: boolean;
}

const ESCAPE_SEQUENCE = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)?/;

export class LineInput {
	private line = '';

	feed(data: string): LineInputResult {
		const result: LineInputResult = { echo: '', lines: [], end: false };
		let index = 0;
		while (index < data.length) {
			const char = data[index];
			if (char === '\x1b') {
				index += ESCAPE_SEQUENCE.exec(data.slice(index))?.[0].length ?? 1;
				continue;
			}
			index++;
			if (char === '\r' || char === '\n') {
				// Pasted text ends lines with \r\n; count it once.
				if (char === '\r' && data[index] === '\n') {
					index++;
				}
				result.lines.push(this.line + '\n');
				result.echo += '\r\n';
				this.line = '';
			} else if (char === '\x7f' || char === '\b') {
				if (this.line.length > 0) {
					this.line = Array.from(this.line).slice(0, -1).join('');
					result.echo += '\b \b';
				}
			} else if (char === '\x04') {
				if (this.line.length === 0) {
					result.end = true;
				}
			} else if (char === '\t' || char >= ' ') {
				this.line += char;
				result.echo += char;
			}
		}
		return result;
	}

	reset(): void {
		this.line = '';
	}
}
