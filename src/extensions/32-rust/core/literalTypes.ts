import { isIdent, isPunct, KEYWORDS, Token } from './lexer';

/**
 * Type hints without rust-analyzer: `let x = 6.5;` gets `: f64`. Only
 * initializers whose type is obvious from the text are covered (literals,
 * `String::from`, `vec![...]`, arrays and tuples of those). Anything else,
 * such as a function call, gets no hint rather than a guess.
 */

export interface TypeHint {
	/** Offset right after the variable name, where `: T` is drawn. */
	offset: number;
	label: string;
}

/** An inferred type. `defaulted` marks unsuffixed numbers, which a suffixed sibling may override. */
interface Inferred {
	type: string;
	defaulted?: 'int' | 'float';
}

const INT_SUFFIX = /(i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize)$/;
const FLOAT_SUFFIX = /(f32|f64)$/;

export function findLetTypeHints(tokens: readonly Token[]): TypeHint[] {
	const hints: TypeHint[] = [];
	for (let i = 0; i < tokens.length; i++) {
		if (!isIdent(tokens[i], 'let')) {
			continue;
		}
		let nameIndex = i + 1;
		if (isIdent(tokens[nameIndex], 'mut')) {
			nameIndex++;
		}
		const name = tokens[nameIndex];
		if (!isIdent(name) || KEYWORDS.has(name.text) || name.text === '_' || !isPunct(tokens[nameIndex + 1], '=')) {
			continue;
		}
		const exprStart = nameIndex + 2;
		const exprEnd = findStatementEnd(tokens, exprStart);
		if (exprEnd < 0) {
			continue;
		}
		const inferred = inferType(tokens.slice(exprStart, exprEnd));
		if (inferred) {
			hints.push({ offset: name.end, label: ': ' + inferred.type });
		}
	}
	return hints;
}

/** Index of the `;` that ends the statement, or -1 (let-else, unterminated, or a block ends first). */
function findStatementEnd(tokens: readonly Token[], start: number): number {
	let depth = 0;
	for (let i = start; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.kind === 'punct') {
			if (token.text === '(' || token.text === '[' || token.text === '{') {
				depth++;
			} else if (token.text === ')' || token.text === ']' || token.text === '}') {
				if (depth === 0) {
					return -1;
				}
				depth--;
			} else if (token.text === ';' && depth === 0) {
				return i;
			}
		} else if (depth === 0 && isIdent(token, 'else')) {
			return -1;
		}
	}
	return -1;
}

/** Infers the type of a whole expression, or undefined when it isn't obvious. */
export function inferType(expr: readonly Token[]): Inferred | undefined {
	if (expr.length === 0) {
		return undefined;
	}
	if (expr.length === 2 && isPunct(expr[0], '-') && expr[1].kind === 'number') {
		return numberType(expr[1].text);
	}
	if (expr.length === 1) {
		return singleTokenType(expr[0]);
	}

	const [first, second, third] = expr;

	// String::new(), String::from(..), String::with_capacity(..)
	if (isIdent(first, 'String') && isPunct(second, '::') && isIdent(third) && ['new', 'from', 'with_capacity'].includes(third.text)) {
		return isCallTail(expr, 3) ? { type: 'String' } : undefined;
	}
	// "text".to_string() / "text".to_owned()
	if (first.kind === 'string' && isPlainStr(first) && isPunct(second, '.') && isIdent(third) && ['to_string', 'to_owned'].includes(third.text)) {
		return expr.length === 5 && isPunct(expr[3], '(') && isPunct(expr[4], ')') ? { type: 'String' } : undefined;
	}
	// format!(..)
	if (isIdent(first, 'format') && isPunct(second, '!') && isGroupTail(expr, 2)) {
		return { type: 'String' };
	}
	// vec![a, b] and vec![x; n]
	if (isIdent(first, 'vec') && isPunct(second, '!') && isGroupTail(expr, 2)) {
		const inner = expr.slice(3, -1);
		const element = sequenceElementType(inner);
		return element ? { type: `Vec<${element.type}>` } : undefined;
	}
	// [a, b, c] and [x; n]
	if (isPunct(first, '[') && isPunct(expr[expr.length - 1], ']') && isBalanced(expr, 0)) {
		return arrayType(expr.slice(1, -1));
	}
	// (a, b)
	if (isPunct(first, '(') && isPunct(expr[expr.length - 1], ')') && isBalanced(expr, 0)) {
		const parts = splitTopLevel(expr.slice(1, -1), ',');
		if (parts.length < 2 && !isPunct(expr[expr.length - 2], ',')) {
			return undefined;
		}
		const types = parts.filter((part) => part.length > 0).map((part) => inferType(part));
		if (types.some((type) => type === undefined)) {
			return undefined;
		}
		const names = (types as Inferred[]).map((type) => type.type);
		return { type: names.length === 1 ? `(${names[0]},)` : `(${names.join(', ')})` };
	}
	return undefined;
}

function singleTokenType(token: Token): Inferred | undefined {
	switch (token.kind) {
		case 'number':
			return numberType(token.text);
		case 'string':
			return isPlainStr(token) ? { type: '&str' } : undefined;
		case 'char':
			return token.prefix === 'b' ? { type: 'u8' } : { type: 'char' };
		case 'ident':
			return token.text === 'true' || token.text === 'false' ? { type: 'bool' } : undefined;
		default:
			return undefined;
	}
}

function isPlainStr(token: Token): boolean {
	return token.prefix === '' || token.prefix === 'r';
}

export function numberType(text: string): Inferred {
	const digits = text.replace(/_/g, '');
	if (/^0[xob]/.test(digits)) {
		const suffix = INT_SUFFIX.exec(digits);
		return suffix ? { type: suffix[1] } : { type: 'i32', defaulted: 'int' };
	}
	const floatSuffix = FLOAT_SUFFIX.exec(digits);
	if (floatSuffix) {
		return { type: floatSuffix[1] };
	}
	const intSuffix = INT_SUFFIX.exec(digits);
	if (intSuffix) {
		return { type: intSuffix[1] };
	}
	return /[.eE]/.test(digits) ? { type: 'f64', defaulted: 'float' } : { type: 'i32', defaulted: 'int' };
}

/** Element type of `a, b, c` or `x; n` (the inside of `vec![..]` or `[..]`). */
function sequenceElementType(inner: readonly Token[]): Inferred | undefined {
	const repeat = splitTopLevel(inner, ';');
	if (repeat.length === 2) {
		return inferType(repeat[0]);
	}
	const elements = splitTopLevel(inner, ',').filter((part) => part.length > 0);
	if (elements.length === 0) {
		return undefined;
	}
	return unify(elements.map((element) => inferType(element)));
}

function arrayType(inner: readonly Token[]): Inferred | undefined {
	const repeat = splitTopLevel(inner, ';');
	if (repeat.length === 2) {
		const element = inferType(repeat[0]);
		const count = repeat[1];
		if (!element || count.length !== 1 || count[0].kind !== 'number' || !/^\d[\d_]*$/.test(count[0].text)) {
			return undefined;
		}
		return { type: `[${element.type}; ${count[0].text.replace(/_/g, '')}]` };
	}
	const elements = splitTopLevel(inner, ',').filter((part) => part.length > 0);
	const element = elements.length > 0 ? unify(elements.map((part) => inferType(part))) : undefined;
	return element ? { type: `[${element.type}; ${elements.length}]` } : undefined;
}

/** All elements must agree; an unsuffixed number takes the type of a suffixed sibling. */
function unify(types: ReadonlyArray<Inferred | undefined>): Inferred | undefined {
	let result: Inferred | undefined;
	for (const type of types) {
		if (!type) {
			return undefined;
		}
		if (!result) {
			result = type;
			continue;
		}
		if (result.type === type.type) {
			if (!type.defaulted) {
				result = type;
			}
			continue;
		}
		if (result.defaulted && !type.defaulted && kindOf(type.type) === result.defaulted) {
			result = type;
		} else if (!(type.defaulted && !result.defaulted && kindOf(result.type) === type.defaulted)) {
			return undefined;
		}
	}
	return result;
}

function kindOf(type: string): 'int' | 'float' | undefined {
	if (FLOAT_SUFFIX.test(type) && /^f\d+$/.test(type)) {
		return 'float';
	}
	return /^[iu](8|16|32|64|128|size)$/.test(type) ? 'int' : undefined;
}

/** Splits on a separator that is not nested inside brackets. */
function splitTopLevel(tokens: readonly Token[], separator: string): Token[][] {
	const parts: Token[][] = [[]];
	let depth = 0;
	for (const token of tokens) {
		if (token.kind === 'punct') {
			if (token.text === '(' || token.text === '[' || token.text === '{') {
				depth++;
			} else if (token.text === ')' || token.text === ']' || token.text === '}') {
				depth--;
			} else if (token.text === separator && depth === 0) {
				parts.push([]);
				continue;
			}
		}
		parts[parts.length - 1].push(token);
	}
	return parts;
}

/** True when `expr[open]` is a bracket whose match is the last token. */
function isBalanced(expr: readonly Token[], open: number): boolean {
	let depth = 0;
	for (let i = open; i < expr.length; i++) {
		const token = expr[i];
		if (token.kind !== 'punct') {
			continue;
		}
		if (token.text === '(' || token.text === '[' || token.text === '{') {
			depth++;
		} else if (token.text === ')' || token.text === ']' || token.text === '}') {
			depth--;
			if (depth === 0) {
				return i === expr.length - 1;
			}
		}
	}
	return false;
}

/** `(..)`, `[..]` or `{..}` from `open` to the end. */
function isGroupTail(expr: readonly Token[], open: number): boolean {
	const token = expr[open];
	return token !== undefined && token.kind === 'punct' && ['(', '[', '{'].includes(token.text) && isBalanced(expr, open);
}

/** `(..)` from `open` to the end. */
function isCallTail(expr: readonly Token[], open: number): boolean {
	return isPunct(expr[open], '(') && isBalanced(expr, open);
}
