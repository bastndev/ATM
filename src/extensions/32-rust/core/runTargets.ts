import { enclosingBraces, isIdent, isPunct, Token } from './lexer';

/**
 * Where the ▶ Run buttons go, found by reading the file's tokens: a
 * top-level `fn main`, test functions and inline `mod` blocks that contain
 * tests. A test is a function with an attribute whose last segment is
 * `test` (`#[test]`, `#[tokio::test]`, `#[async_std::test(...)]`), the same
 * rule rust-analyzer uses. Comments and strings never count.
 */

export type RunTargetKind = 'main' | 'test' | 'testModule';

export interface RunTarget {
	kind: RunTargetKind;
	/** Offset of the function or module name; the button goes on its line. */
	offset: number;
	/** Path inside this file: ['tests', 'adds'] for `mod tests { fn adds() }`, [] for main. */
	path: string[];
}

/** Words that may stand between a test attribute and `fn`, as in `pub async unsafe fn`. */
const FN_QUALIFIERS = new Set(['pub', 'async', 'unsafe', 'const', 'extern', 'default', 'safe']);

export function findRunTargets(tokens: readonly Token[]): RunTarget[] {
	const owner = enclosingBraces(tokens);
	const modules = inlineModules(tokens);

	/** Module path at `index`, or undefined inside a function, impl or other block the test runner can't reach. */
	const modulePathAt = (index: number): string[] | undefined => {
		const path: string[] = [];
		for (let brace = owner[index]; brace >= 0; brace = owner[brace]) {
			const nameIndex = modules.get(brace);
			if (nameIndex === undefined) {
				return undefined;
			}
			path.unshift(tokens[nameIndex].text);
		}
		return path;
	};

	const targets: RunTarget[] = [];
	const tests: string[][] = [];
	let testAttribute = false;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (isPunct(token, '#')) {
			// `#![...]` belongs to the enclosing item, so it never marks the next function.
			const inner = isPunct(tokens[i + 1], '!');
			const open = inner ? i + 2 : i + 1;
			if (isPunct(tokens[open], '[')) {
				const close = closingBracket(tokens, open);
				testAttribute = !inner && (testAttribute || isTestAttribute(tokens, open + 1, close));
				i = close;
				continue;
			}
		}

		if (isIdent(token, 'fn') && isIdent(tokens[i + 1])) {
			const name = tokens[i + 1];
			const path = modulePathAt(i);
			if (path && testAttribute) {
				const testPath = [...path, name.text];
				targets.push({ kind: 'test', offset: name.start, path: testPath });
				tests.push(testPath);
			} else if (path && path.length === 0 && name.text === 'main') {
				targets.push({ kind: 'main', offset: name.start, path: [] });
			}
			testAttribute = false;
			i++;
			continue;
		}

		// `pub(crate)`, `pub(super)` and `pub(in path)` keep a pending test attribute.
		if (isPunct(token, '(') && isIdent(tokens[i - 1], 'pub')) {
			while (i < tokens.length && !isPunct(tokens[i], ')')) {
				i++;
			}
			continue;
		}
		const qualifier =
			(token.kind === 'ident' && FN_QUALIFIERS.has(token.text)) || (token.kind === 'string' && isIdent(tokens[i - 1], 'extern'));
		if (!qualifier) {
			testAttribute = false;
		}
	}

	// ▶ Run Tests above every inline module that holds tests, directly or in a nested module.
	for (const nameIndex of modules.values()) {
		const parent = modulePathAt(nameIndex);
		if (!parent) {
			continue;
		}
		const path = [...parent, tokens[nameIndex].text];
		if (tests.some((test) => test.length > path.length && path.every((segment, index) => test[index] === segment))) {
			targets.push({ kind: 'testModule', offset: tokens[nameIndex].start, path });
		}
	}

	return targets.sort((a, b) => a.offset - b.offset);
}

/** Names of the modules a crate root declares at top level, with `mod name;` or `mod name { … }`. */
export function topLevelModules(tokens: readonly Token[]): Set<string> {
	const owner = enclosingBraces(tokens);
	const names = new Set<string>();
	for (let i = 0; i < tokens.length; i++) {
		if (owner[i] === -1 && isIdent(tokens[i], 'mod') && isIdent(tokens[i + 1]) && (isPunct(tokens[i + 2], ';') || isPunct(tokens[i + 2], '{'))) {
			names.add(tokens[i + 1].text);
		}
	}
	return names;
}

/** For each `{` that opens `mod name { … }`, the index of the name token. */
function inlineModules(tokens: readonly Token[]): Map<number, number> {
	const modules = new Map<number, number>();
	tokens.forEach((token, index) => {
		if (isPunct(token, '{') && isIdent(tokens[index - 1]) && isIdent(tokens[index - 2], 'mod')) {
			modules.set(index, index - 1);
		}
	});
	return modules;
}

/** Index of the `]` closing the `[` at `open`, or tokens.length when it is unclosed. */
function closingBracket(tokens: readonly Token[], open: number): number {
	let depth = 0;
	for (let i = open; i < tokens.length; i++) {
		if (isPunct(tokens[i], '[')) {
			depth++;
		} else if (isPunct(tokens[i], ']') && --depth === 0) {
			return i;
		}
	}
	return tokens.length;
}

/** True when the attribute's path, such as `test` or `tokio::test`, ends in `test`. */
function isTestAttribute(tokens: readonly Token[], from: number, to: number): boolean {
	let i = isPunct(tokens[from], '::') ? from + 1 : from;
	let last: string | undefined;
	while (i < to && isIdent(tokens[i])) {
		last = tokens[i].text;
		if (!isPunct(tokens[i + 1], '::')) {
			break;
		}
		i += 2;
	}
	return last === 'test';
}
