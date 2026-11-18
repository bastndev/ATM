/**
 * A small Rust tokenizer for the features that work without rust-analyzer
 * (simple type hints and the `mut` underline). It knows enough to never
 * mistake comments, strings, chars or lifetimes for code; it does not parse.
 */

export type TokenKind = 'ident' | 'lifetime' | 'number' | 'string' | 'char' | 'punct';

export interface Token {
	kind: TokenKind;
	/** Source text. Raw identifiers keep their `r#` prefix. */
	text: string;
	start: number;
	end: number;
	/** String and char prefix: `b`, `c`, `r`, `br` or `cr`; empty for plain ones. */
	prefix?: string;
}

const PUNCT_3 = ['..=', '...', '<<=', '>>='];
const PUNCT_2 = ['::', '->', '=>', '==', '!=', '<=', '>=', '&&', '||', '..', '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '<<', '>>'];

const STRING_PREFIXES = new Set(['b', 'c', 'r', 'br', 'cr']);

function isIdentStart(ch: string): boolean {
	return /[A-Za-z_]/.test(ch) || ch.charCodeAt(0) > 0x7f;
}

function isIdentPart(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) > 0x7f;
}

function isDigit(ch: string | undefined): boolean {
	return ch !== undefined && ch >= '0' && ch <= '9';
}

export function tokenizeRust(text: string): Token[] {
	const tokens: Token[] = [];
	const length = text.length;
	let i = 0;

	while (i < length) {
		const ch = text[i];

		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			i++;
			continue;
		}

		// Comments, including nested block comments.
		if (ch === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? length : end;
			continue;
		}
		if (ch === '/' && text[i + 1] === '*') {
			let depth = 1;
			i += 2;
			while (i < length && depth > 0) {
				if (text[i] === '/' && text[i + 1] === '*') {
					depth++;
					i += 2;
				} else if (text[i] === '*' && text[i + 1] === '/') {
					depth--;
					i += 2;
				} else {
					i++;
				}
			}
			continue;
		}

		if (isIdentStart(ch)) {
			let end = i + 1;
			while (end < length && isIdentPart(text[end])) {
				end++;
			}
			const word = text.slice(i, end);

			if (STRING_PREFIXES.has(word)) {
				const next = text[end];
				const raw = word.endsWith('r');
				if (next === '"' || (raw && next === '#' && /^#+"/.test(text.slice(end)))) {
					const close = raw ? readRawString(text, end) : readQuoted(text, end, '"');
					tokens.push({ kind: 'string', text: text.slice(i, close), start: i, end: close, prefix: word });
					i = close;
					continue;
				}
				if (word === 'b' && next === "'") {
					const close = readQuoted(text, end, "'");
					tokens.push({ kind: 'char', text: text.slice(i, close), start: i, end: close, prefix: 'b' });
					i = close;
					continue;
				}
			}
			if (word === 'r' && text[end] === '#' && isIdentStart(text[end + 1] ?? '')) {
				// Raw identifier such as r#type.
				end += 2;
				while (end < length && isIdentPart(text[end])) {
					end++;
				}
			}
			tokens.push({ kind: 'ident', text: text.slice(i, end), start: i, end });
			i = end;
			continue;
		}

		if (isDigit(ch)) {
			const end = readNumber(text, i);
			tokens.push({ kind: 'number', text: text.slice(i, end), start: i, end });
			i = end;
			continue;
		}

		if (ch === '"') {
			const close = readQuoted(text, i, '"');
			tokens.push({ kind: 'string', text: text.slice(i, close), start: i, end: close, prefix: '' });
			i = close;
			continue;
		}

		if (ch === "'") {
			const charEnd = matchCharLiteral(text, i);
			if (charEnd > 0) {
				tokens.push({ kind: 'char', text: text.slice(i, charEnd), start: i, end: charEnd, prefix: '' });
				i = charEnd;
				continue;
			}
			if (isIdentStart(text[i + 1] ?? '')) {
				let end = i + 2;
				while (end < length && isIdentPart(text[end])) {
					end++;
				}
				tokens.push({ kind: 'lifetime', text: text.slice(i, end), start: i, end });
				i = end;
				continue;
			}
		}

		const punct = [...PUNCT_3, ...PUNCT_2].find((p) => text.startsWith(p, i)) ?? ch;
		tokens.push({ kind: 'punct', text: punct, start: i, end: i + punct.length });
		i += punct.length;
	}

	return tokens;
}

/** Reads a quoted literal starting at the opening quote; returns the offset after the closing quote. */
function readQuoted(text: string, open: number, quote: string): number {
	let i = open + 1;
	while (i < text.length) {
		if (text[i] === '\\') {
			i += 2;
			continue;
		}
		if (text[i] === quote) {
			return i + 1;
		}
		i++;
	}
	return text.length;
}

/** Reads `#*"..."#*` starting at the first `#` or quote after the `r`. */
function readRawString(text: string, start: number): number {
	let hashes = 0;
	let i = start;
	while (text[i] === '#') {
		hashes++;
		i++;
	}
	const closing = '"' + '#'.repeat(hashes);
	const close = text.indexOf(closing, i + 1);
	return close < 0 ? text.length : close + closing.length;
}

/** Returns the end of a char literal at `open`, or 0 when the quote starts a lifetime. */
function matchCharLiteral(text: string, open: number): number {
	if (text[open + 1] === '\\') {
		return readQuoted(text, open, "'");
	}
	const codePoint = text.codePointAt(open + 1);
	if (codePoint === undefined || text[open + 1] === '\n') {
		return 0;
	}
	const width = codePoint > 0xffff ? 2 : 1;
	return text[open + 1 + width] === "'" ? open + 2 + width : 0;
}

function readNumber(text: string, start: number): number {
	let i = start;
	if (text[i] === '0' && /[xob]/.test(text[i + 1] ?? '')) {
		i += 2;
		while (i < text.length && /[0-9a-fA-F_]/.test(text[i])) {
			i++;
		}
		return readSuffix(text, i);
	}
	while (i < text.length && /[0-9_]/.test(text[i])) {
		i++;
	}
	// `1.5` and `1.` are floats; `1..2`, `1.max(2)` and `tuple.0.1` are not.
	if (text[i] === '.' && text[i + 1] !== '.' && !isIdentStart(text[i + 1] ?? '')) {
		i++;
		while (i < text.length && /[0-9_]/.test(text[i])) {
			i++;
		}
	}
	if (/[eE]/.test(text[i] ?? '')) {
		const sign = /[+-]/.test(text[i + 1] ?? '') ? 1 : 0;
		if (isDigit(text[i + 1 + sign])) {
			i += 1 + sign;
			while (i < text.length && /[0-9_]/.test(text[i])) {
				i++;
			}
		}
	}
	return readSuffix(text, i);
}

function readSuffix(text: string, i: number): number {
	while (i < text.length && isIdentPart(text[i])) {
		i++;
	}
	return i;
}

/**
 * For each `{` token, the index of its matching `}` (or tokens.length when
 * unclosed). For every other token, -1.
 */
export function matchBraces(tokens: readonly Token[]): number[] {
	const close = new Array<number>(tokens.length).fill(-1);
	const stack: number[] = [];
	tokens.forEach((token, index) => {
		if (token.kind !== 'punct') {
			return;
		}
		if (token.text === '{') {
			stack.push(index);
		} else if (token.text === '}') {
			const open = stack.pop();
			if (open !== undefined) {
				close[open] = index;
			}
		}
	});
	for (const open of stack) {
		close[open] = tokens.length;
	}
	return close;
}

/** For each token, the index of the innermost `{` that contains it, or -1 at file level. */
export function enclosingBraces(tokens: readonly Token[]): number[] {
	const owner = new Array<number>(tokens.length).fill(-1);
	const stack: number[] = [];
	tokens.forEach((token, index) => {
		if (token.kind === 'punct' && token.text === '}') {
			stack.pop();
		}
		owner[index] = stack.length > 0 ? stack[stack.length - 1] : -1;
		if (token.kind === 'punct' && token.text === '{') {
			stack.push(index);
		}
	});
	return owner;
}

export function isPunct(token: Token | undefined, text: string): boolean {
	return token !== undefined && token.kind === 'punct' && token.text === text;
}

export function isIdent(token: Token | undefined, text?: string): boolean {
	return token !== undefined && token.kind === 'ident' && (text === undefined || token.text === text);
}

/** Rust keywords that can never be a variable name. */
export const KEYWORDS = new Set([
	'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false',
	'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
	'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
]);
