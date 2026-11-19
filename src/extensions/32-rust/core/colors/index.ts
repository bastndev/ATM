import { Token } from '../lexer';
import { CallMatch, ColorPresentation, findCallColors, presentCall } from './calls';
import { Rgba } from './rgba';
import { findStringColors, presentString, StringMatch } from './strings';

/**
 * Colour swatches and the colour picker for Rust. Everything works from the
 * tokens of the open file (comments are already gone), so it costs one pass
 * over tokens the type hints have already read.
 */

export type { ColorPresentation } from './calls';
export type { Rgba } from './rgba';
export type ColorMatch = CallMatch | StringMatch;

/** Every colour in the file, in order. */
export function findColors(tokens: readonly Token[]): ColorMatch[] {
	return findColorsIn(tokens, 0, tokens.length);
}

/**
 * The picker's choices for the colour at [start, end), current format
 * first, or none when that text is no longer a colour. Only the tokens
 * around the range are examined: the picker asks on every drag.
 */
export function colorPresentations(tokens: readonly Token[], start: number, end: number, original: string, color: Rgba): ColorPresentation[] {
	const from = Math.max(0, lastTokenStartingAtOrBefore(tokens, start));
	const to = firstTokenStartingAtOrAfter(tokens, end);
	const match = findColorsIn(tokens, from, to).find((found) => found.start === start && found.end === end);
	if (!match) {
		return [];
	}
	return match.kind === 'string' ? presentString(match, color) : presentCall(match, color, original);
}

function findColorsIn(tokens: readonly Token[], from: number, to: number): ColorMatch[] {
	const matches: ColorMatch[] = findCallColors(tokens, from, to);
	for (let index = from; index < to; index++) {
		if (tokens[index].kind === 'string') {
			matches.push(...findStringColors(tokens, index));
		}
	}
	return matches.sort((a, b) => a.start - b.start);
}

/** Binary search: the last token that starts at or before `offset` (-1 when none). */
function lastTokenStartingAtOrBefore(tokens: readonly Token[], offset: number): number {
	let low = 0;
	let high = tokens.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (tokens[middle].start <= offset) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return found;
}

function firstTokenStartingAtOrAfter(tokens: readonly Token[], offset: number): number {
	return lastTokenStartingAtOrBefore(tokens, offset - 1) + 1;
}
