import { enclosingBraces, isIdent, isPunct, KEYWORDS, matchBraces, Token } from './lexer';

/**
 * The `mut` underline, read from the code: every variable declared with
 * `mut` is underlined where it is declared and where it is used, so values
 * that can change stand out. Scopes are followed by braces, and a later
 * `let` with the same name (shadowing) ends the underline.
 */

export interface Span {
	start: number;
	end: number;
}

interface Scope {
	/** First token index that can use the variable. */
	from: number;
	/** Token index where the scope ends (exclusive). */
	to: number;
}

export function findMutableSpans(tokens: readonly Token[]): Span[] {
	const closeOf = matchBraces(tokens);
	const ownerOf = enclosingBraces(tokens);
	const spans: Span[] = [];

	for (let i = 0; i < tokens.length; i++) {
		if (!isIdent(tokens[i], 'mut')) {
			continue;
		}
		// `&mut x`, `&&mut x` and `*mut T` borrow or name a type; they declare nothing.
		if (isBorrow(tokens[i - 1])) {
			continue;
		}
		const nameIndex = i + 1;
		const name = tokens[nameIndex];
		if (!isIdent(name) || KEYWORDS.has(name.text) || name.text === '_') {
			continue;
		}
		spans.push({ start: name.start, end: name.end });

		const scope = findScope(tokens, i, closeOf, ownerOf);
		if (scope) {
			collectUses(tokens, name.text, scope, closeOf, ownerOf, spans);
		}
	}

	return spans;
}

/** Where a `mut` binding at `mutIndex` is visible, or undefined to underline only the declaration. */
function findScope(tokens: readonly Token[], mutIndex: number, closeOf: number[], ownerOf: number[]): Scope | undefined {
	const owner = ownerOf[mutIndex];
	const blockEnd = owner >= 0 ? closeOf[owner] : tokens.length;

	if (isIdent(tokens[mutIndex - 1], 'static')) {
		return { from: 0, to: tokens.length };
	}

	// Walk back to the start of the statement to see what introduces the binding.
	for (let j = mutIndex - 1; j >= 0; j--) {
		const token = tokens[j];
		if (token.kind === 'punct' && (token.text === ';' || token.text === '{' || token.text === '}')) {
			break;
		}
		if (isIdent(token, 'let')) {
			const before = tokens[j - 1];
			// `if let` / `while let`: visible in the block that follows.
			if (isIdent(before, 'if') || isIdent(before, 'while')) {
				return nextBlock(tokens, mutIndex, closeOf);
			}
			// `let mut x = ..;`: visible until the end of the enclosing block.
			return { from: mutIndex + 2, to: blockEnd };
		}
		// Function parameters and `for mut x in ..`: visible in the body.
		if (isIdent(token, 'fn') || isIdent(token, 'for')) {
			return nextBlock(tokens, mutIndex, closeOf);
		}
		if (token.kind === 'punct' && (token.text === '=>' || token.text === '|')) {
			return undefined;
		}
	}
	return undefined;
}

/** The first `{ .. }` after `index` at the same brace level, stopping at `;` (a body-less declaration). */
function nextBlock(tokens: readonly Token[], index: number, closeOf: number[]): Scope | undefined {
	let depth = 0;
	for (let j = index + 1; j < tokens.length; j++) {
		const token = tokens[j];
		if (token.kind !== 'punct') {
			continue;
		}
		if (token.text === '(' || token.text === '[') {
			depth++;
		} else if (token.text === ')' || token.text === ']') {
			depth--;
		} else if (depth <= 0 && token.text === ';') {
			return undefined;
		} else if (depth <= 0 && token.text === '{') {
			return { from: j + 1, to: closeOf[j] };
		} else if (token.text === '}') {
			return undefined;
		}
	}
	return undefined;
}

function collectUses(
	tokens: readonly Token[],
	name: string,
	scope: Scope,
	closeOf: number[],
	ownerOf: number[],
	spans: Span[],
): void {
	for (let j = scope.from; j < scope.to && j < tokens.length; j++) {
		const token = tokens[j];
		if (token.kind !== 'ident' || token.text !== name) {
			continue;
		}
		const previous = tokens[j - 1];
		const next = tokens[j + 1];

		// A new `let name` / `let mut name` hides this one until its block ends.
		if (isIdent(previous, 'let') || (isIdent(previous, 'mut') && isIdent(tokens[j - 2], 'let'))) {
			const owner = ownerOf[j];
			const end = owner >= 0 ? closeOf[owner] : tokens.length;
			if (end >= scope.to) {
				return;
			}
			j = end;
			continue;
		}
		// `mut name` is another declaration (it gets its own pass); `&mut name` is a use.
		if (isIdent(previous, 'mut') && !isBorrow(tokens[j - 2])) {
			continue;
		}
		// Field access, paths, macros and `field: value` in struct literals are not the variable.
		if (isPunct(previous, '.') || isPunct(previous, '::') || isPunct(next, '::') || isPunct(next, '!')) {
			continue;
		}
		if (isPunct(next, ':') && (isPunct(previous, '{') || isPunct(previous, ','))) {
			continue;
		}
		spans.push({ start: token.start, end: token.end });
	}
}

function isBorrow(token: Token | undefined): boolean {
	return token !== undefined && token.kind === 'punct' && ['&', '&&', '*'].includes(token.text);
}
