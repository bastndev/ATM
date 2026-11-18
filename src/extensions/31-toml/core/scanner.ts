/**
 * Error-tolerant structural scanner for TOML.
 *
 * It finds what folding and the outline need — table headers, key/value
 * entries (with nested arrays and inline tables), multi-line strings and
 * comments — as offsets into the source text. It never throws and keeps going
 * on invalid input, so folding and the outline keep working while the user
 * types. Syntax errors are reported separately by smol-toml (see validate.ts).
 */

export interface Span {
	/** Offset of the first character. */
	start: number;
	/** Offset just past the last character. */
	end: number;
}

export interface KeySegment {
	/** The key as written, quotes included (for example `"*"`). */
	raw: string;
	/** The key without quotes, used to compare keys. */
	name: string;
	span: Span;
}

export type ValueKind = 'string' | 'number' | 'boolean' | 'datetime' | 'array' | 'inlineTable' | 'invalid';

export interface TomlValue {
	kind: ValueKind;
	span: Span;
	/** True for `"""` and `'''` strings. */
	multiline?: boolean;
	/** Items of an array. */
	items?: TomlValue[];
	/** Entries of an inline table. */
	entries?: TomlEntry[];
}

export interface TomlEntry {
	keys: KeySegment[];
	keySpan: Span;
	value: TomlValue;
	/** From the first key character to the end of the value. */
	span: Span;
}

export interface TomlTable {
	kind: 'table' | 'arrayTable';
	keys: KeySegment[];
	keySpan: Span;
	/** The header, from `[` to `]`. */
	span: Span;
	entries: TomlEntry[];
}

export interface TomlComment {
	span: Span;
	/** True when only whitespace precedes the comment on its line. */
	ownLine: boolean;
}

export interface TomlModel {
	text: string;
	/** Offset where each line starts. */
	lineStarts: number[];
	/** Entries before the first table header. */
	rootEntries: TomlEntry[];
	tables: TomlTable[];
	comments: TomlComment[];
}

export function scanToml(text: string): TomlModel {
	return new Scanner(text).scan();
}

/** Zero-based line that contains `offset`. */
export function lineOf(model: TomlModel, offset: number): number {
	const starts = model.lineStarts;
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (starts[mid] <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return low;
}

/** Offset of the end of `line`, before its line break. */
export function lineEndOffset(model: TomlModel, line: number): number {
	const start = model.lineStarts[line];
	const end = line + 1 < model.lineStarts.length ? model.lineStarts[line + 1] - 1 : model.text.length;
	return end > start && model.text[end - 1] === '\r' ? end - 1 : end;
}

export function lineText(model: TomlModel, line: number): string {
	return model.text.slice(model.lineStarts[line], lineEndOffset(model, line));
}

/** Nested arrays and inline tables deeper than this are not explored. */
const MAX_DEPTH = 64;
const VALUE_DELIMITERS = ' \t\r\n,]}#';

const SCALARS: ReadonlyArray<[RegExp, ValueKind]> = [
	[/true|false/y, 'boolean'],
	[/\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/y, 'datetime'],
	[/[+-]?(?:inf|nan)|[+-]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/y, 'number'],
];

const KEY_PART = String.raw`(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')`;
/**
 * A `[table]` header made of bare keys. Inside an unclosed array or inline
 * table, a line like this means the value was never closed, so the scanner
 * stops there instead of swallowing the rest of the file.
 */
const HEADER_LINE = new RegExp(
	String.raw`\[\[?[ \t]*(?!(?:true|false|inf|nan)[ \t\]])[A-Za-z_][A-Za-z0-9_-]*(?:[ \t]*\.[ \t]*${KEY_PART})*[ \t]*\]\]?[ \t]*(?:#[^\n]*)?(?:\r?\n|$)`,
	'y',
);
/** A `key =` line, which can never be an array item. */
const KEY_VALUE_LINE = new RegExp(String.raw`${KEY_PART}(?:[ \t]*\.[ \t]*${KEY_PART})*[ \t]*=`, 'y');

class Scanner {
	private pos = 0;
	private readonly comments: TomlComment[] = [];

	constructor(private readonly text: string) {}

	scan(): TomlModel {
		const { text } = this;
		const rootEntries: TomlEntry[] = [];
		const tables: TomlTable[] = [];
		let target = rootEntries;

		while (this.pos < text.length) {
			this.skipSpaces();
			const ch = text[this.pos];
			if (ch === undefined) {
				break;
			}
			if (ch === '\n') {
				this.pos++;
				continue;
			}
			if (ch === '#') {
				this.readComment();
				continue;
			}
			if (ch === '[') {
				const table = this.readHeader();
				if (table) {
					tables.push(table);
					target = table.entries;
				}
			} else {
				const entry = this.readEntry(0);
				if (entry) {
					target.push(entry);
				}
			}
			this.finishLine();
		}

		return { text, lineStarts: computeLineStarts(text), rootEntries, tables, comments: this.comments };
	}

	private readHeader(): TomlTable | undefined {
		const start = this.pos;
		const isArray = this.text[start + 1] === '[';
		this.pos += isArray ? 2 : 1;
		const keys = this.readKey();
		if (!keys) {
			return undefined;
		}
		this.skipSpaces();
		if (this.text[this.pos] === ']') {
			this.pos++;
			if (isArray && this.text[this.pos] === ']') {
				this.pos++;
			}
		}
		return {
			kind: isArray ? 'arrayTable' : 'table',
			keys,
			keySpan: keysSpan(keys),
			span: { start, end: this.pos },
			entries: [],
		};
	}

	private readEntry(depth: number): TomlEntry | undefined {
		const keys = this.readKey();
		if (!keys) {
			return undefined;
		}
		const keySpan = keysSpan(keys);
		this.skipSpaces();
		if (this.text[this.pos] !== '=') {
			return undefined;
		}
		this.pos++;
		this.skipSpaces();
		const value = this.readValue(depth);
		return { keys, keySpan, value, span: { start: keySpan.start, end: Math.max(value.span.end, keySpan.end) } };
	}

	private readKey(): KeySegment[] | undefined {
		const keys: KeySegment[] = [];
		for (;;) {
			this.skipSpaces();
			const key = this.readKeySegment();
			if (!key) {
				break;
			}
			keys.push(key);
			this.skipSpaces();
			if (this.text[this.pos] !== '.') {
				break;
			}
			this.pos++;
		}
		return keys.length > 0 ? keys : undefined;
	}

	private readKeySegment(): KeySegment | undefined {
		const start = this.pos;
		const ch = this.text[start];
		if (ch === '"' || ch === "'") {
			this.pos = this.scanQuoted(start, ch);
			const raw = this.text.slice(start, this.pos);
			return { raw, name: unquote(raw), span: { start, end: this.pos } };
		}
		while (this.pos < this.text.length && isBareKeyChar(this.text.charCodeAt(this.pos))) {
			this.pos++;
		}
		if (this.pos === start) {
			return undefined;
		}
		const raw = this.text.slice(start, this.pos);
		return { raw, name: raw, span: { start, end: this.pos } };
	}

	private readValue(depth: number): TomlValue {
		const { text } = this;
		const start = this.pos;
		const ch = text[start];
		if (depth > MAX_DEPTH) {
			return this.readInvalid(start);
		}
		if (ch === '"' || ch === "'") {
			if (text.startsWith(ch.repeat(3), start)) {
				this.pos = this.scanMultiline(start, ch);
				return { kind: 'string', multiline: true, span: { start, end: this.pos } };
			}
			this.pos = this.scanQuoted(start, ch);
			return { kind: 'string', span: { start, end: this.pos } };
		}
		if (ch === '[') {
			return this.readArray(depth);
		}
		if (ch === '{') {
			return this.readInlineTable(depth);
		}
		return this.readScalar(start);
	}

	private readArray(depth: number): TomlValue {
		const start = this.pos;
		const items: TomlValue[] = [];
		this.pos++;
		// If the array is never closed, it ends after its last item, not on the next statement's line.
		let end = this.pos;
		while (this.pos < this.text.length) {
			this.skipTrivia();
			const ch = this.text[this.pos];
			if (ch === undefined) {
				break;
			}
			if (ch === ']' || ch === ',') {
				this.pos++;
				end = this.pos;
				if (ch === ']') {
					break;
				}
				continue;
			}
			if (this.startsNewStatement(true)) {
				break;
			}
			const item = this.readValue(depth + 1);
			if (item.span.end > item.span.start) {
				items.push(item);
				end = item.span.end;
			} else {
				this.pos++;
			}
		}
		return { kind: 'array', span: { start, end }, items };
	}

	private readInlineTable(depth: number): TomlValue {
		const start = this.pos;
		const entries: TomlEntry[] = [];
		this.pos++;
		let end = this.pos;
		while (this.pos < this.text.length) {
			this.skipTrivia();
			const ch = this.text[this.pos];
			if (ch === undefined) {
				break;
			}
			if (ch === '}' || ch === ',') {
				this.pos++;
				end = this.pos;
				if (ch === '}') {
					break;
				}
				continue;
			}
			if (this.startsNewStatement(false)) {
				break;
			}
			const before = this.pos;
			const entry = this.readEntry(depth + 1);
			if (entry) {
				entries.push(entry);
				end = entry.span.end;
			}
			if (this.pos === before) {
				this.pos++;
			}
		}
		return { kind: 'inlineTable', span: { start, end }, entries };
	}

	private readScalar(start: number): TomlValue {
		for (const [pattern, kind] of SCALARS) {
			pattern.lastIndex = start;
			const match = pattern.exec(this.text);
			if (match && match[0].length > 0 && this.isValueEnd(start + match[0].length)) {
				this.pos = start + match[0].length;
				return { kind, span: { start, end: this.pos } };
			}
		}
		return this.readInvalid(start);
	}

	private readInvalid(start: number): TomlValue {
		let end = start;
		while (end < this.text.length && !VALUE_DELIMITERS.includes(this.text[end])) {
			end++;
		}
		this.pos = end;
		return { kind: 'invalid', span: { start, end } };
	}

	private readComment(): void {
		const start = this.pos;
		let end = this.text.indexOf('\n', start);
		if (end === -1) {
			end = this.text.length;
		}
		this.pos = end;
		const spanEnd = end > start && this.text[end - 1] === '\r' ? end - 1 : end;
		this.comments.push({ span: { start, end: spanEnd }, ownLine: this.atLineStart(start) });
	}

	/** Returns the offset just past a single-line string, or the line end if it is not closed. */
	private scanQuoted(start: number, quote: string): number {
		const { text } = this;
		let i = start + 1;
		while (i < text.length) {
			const c = text[i];
			if (c === '\n') {
				return text[i - 1] === '\r' ? i - 1 : i;
			}
			if (c === '\\' && quote === '"') {
				i += text[i + 1] === '\n' ? 1 : 2;
				continue;
			}
			i++;
			if (c === quote) {
				return i;
			}
		}
		return text.length;
	}

	/** Returns the offset just past a `"""` or `'''` string, or the end of the text if it is not closed. */
	private scanMultiline(start: number, quote: string): number {
		const { text } = this;
		const delimiter = quote.repeat(3);
		let i = start + 3;
		while (i < text.length) {
			const c = text[i];
			if (c === '\\' && quote === '"') {
				i += 2;
				continue;
			}
			if (c === quote && text.startsWith(delimiter, i)) {
				i += 3;
				// Up to two more quotes are part of the content (`""""` ends with a quote).
				for (let extra = 0; extra < 2 && text[i] === quote; extra++) {
					i++;
				}
				return i;
			}
			i++;
		}
		return text.length;
	}

	/** True when the scanner, inside an unclosed array or inline table, reached a line that starts a new statement. */
	private startsNewStatement(inArray: boolean): boolean {
		if (!this.atLineStart(this.pos)) {
			return false;
		}
		HEADER_LINE.lastIndex = this.pos;
		if (HEADER_LINE.test(this.text)) {
			return true;
		}
		if (!inArray) {
			return false;
		}
		KEY_VALUE_LINE.lastIndex = this.pos;
		return KEY_VALUE_LINE.test(this.text);
	}

	/** Skips whatever is left on the line after a header or entry. */
	private finishLine(): void {
		this.skipSpaces();
		if (this.text[this.pos] === '#') {
			this.readComment();
			return;
		}
		// An unclosed value stopped at the start of a new statement: keep it.
		if (this.atLineStart(this.pos)) {
			return;
		}
		const end = this.text.indexOf('\n', this.pos);
		this.pos = end === -1 ? this.text.length : end;
	}

	/** Skips spaces, line breaks and comments between array items and inline table entries. */
	private skipTrivia(): void {
		for (;;) {
			this.skipSpaces();
			const ch = this.text[this.pos];
			if (ch === '\n') {
				this.pos++;
			} else if (ch === '#') {
				this.readComment();
			} else {
				return;
			}
		}
	}

	private skipSpaces(): void {
		const { text } = this;
		while (this.pos < text.length) {
			const c = text[this.pos];
			if (c !== ' ' && c !== '\t' && c !== '\r') {
				return;
			}
			this.pos++;
		}
	}

	private atLineStart(offset: number): boolean {
		for (let i = offset - 1; i >= 0; i--) {
			const c = this.text[i];
			if (c === '\n') {
				return true;
			}
			if (c !== ' ' && c !== '\t') {
				return false;
			}
		}
		return true;
	}

	private isValueEnd(offset: number): boolean {
		return offset >= this.text.length || VALUE_DELIMITERS.includes(this.text[offset]);
	}
}

function computeLineStarts(text: string): number[] {
	const starts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
		starts.push(i + 1);
	}
	return starts;
}

function keysSpan(keys: KeySegment[]): Span {
	return { start: keys[0].span.start, end: keys[keys.length - 1].span.end };
}

function isBareKeyChar(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) || // 0-9
		(code >= 0x41 && code <= 0x5a) || // A-Z
		(code >= 0x61 && code <= 0x7a) || // a-z
		code === 0x5f || // _
		code === 0x2d || // -
		code > 0x7f // be lenient with non-ASCII keys; validation reports them
	);
}

const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };

function unquote(raw: string): string {
	const quote = raw[0];
	const closed = raw.length >= 2 && raw.endsWith(quote);
	const inner = raw.slice(1, closed ? -1 : undefined);
	if (quote === "'") {
		return inner;
	}
	return inner.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|x[0-9A-Fa-f]{2}|.)/g, (match: string, escape: string) => {
		if (escape.length > 1) {
			const code = parseInt(escape.slice(1), 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ESCAPES[escape] ?? match;
	});
}
