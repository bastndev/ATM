/**
 * Rust number literals as they are written, so a value changed by the
 * colour picker keeps its look: `10` stays a plain integer, `0x8B` stays
 * upper-case hex with two digits, `0.50f32` keeps its decimals and suffix,
 * and `0xAE_F9_58` keeps its underscores.
 */

export interface NumberLiteral {
	value: number;
	style: NumberStyle;
}

export interface NumberStyle {
	float: boolean;
	hex: boolean;
	/** Hex digits written in upper case. */
	upper: boolean;
	/** Hex: digits written (zero padding). Float: decimals written. */
	digits: number;
	/** Positions of `_` among hex digits, counted from the right, to put them back. */
	groups: number[];
	/** `u8`, `_u8`, `f32`… or empty. */
	suffix: string;
	/** Written as `1.` with nothing after the dot. */
	trailingDot: boolean;
}

/** The style used for a number the user didn't write (switching to another format). */
export function plainStyle(float: boolean): NumberStyle {
	return { float, hex: false, upper: false, digits: float ? 1 : 0, groups: [], suffix: '', trailingDot: false };
}

const INT_TYPES = '(?:[iu](?:8|16|32|64|128|size))';
const HEX = new RegExp(`^0x([0-9a-fA-F_]*[0-9a-fA-F])(_*${INT_TYPES})?$`);
// Digit groups end with a digit, so in `255_u8` the `_` stays with the suffix.
const DIGITS = '[0-9](?:[0-9_]*[0-9])?';
const DECIMAL = new RegExp(`^(${DIGITS})(?:(\\.)(${DIGITS})?)?([eE][+-]?[0-9_]+)?(_*(?:${INT_TYPES}|f32|f64))?$`);

/** Parses one number token; undefined for binary/octal and anything unexpected. */
export function parseNumber(text: string): NumberLiteral | undefined {
	const hex = HEX.exec(text);
	if (hex) {
		const written = hex[1];
		const digits = written.replace(/_/g, '');
		return {
			value: parseInt(digits, 16),
			style: {
				float: false,
				hex: true,
				upper: /[A-F]/.test(digits) && !/[a-f]/.test(digits),
				digits: digits.length,
				groups: underscorePositions(written),
				suffix: hex[2] ?? '',
				trailingDot: false,
			},
		};
	}
	const decimal = DECIMAL.exec(text);
	if (!decimal) {
		return undefined;
	}
	const [, whole, dot, fraction, exponent, suffix = ''] = decimal;
	const float = dot !== undefined || exponent !== undefined || /f(?:32|64)$/.test(suffix);
	const number = `${whole.replace(/_/g, '')}${dot && fraction ? '.' + fraction.replace(/_/g, '') : ''}${exponent?.replace(/_/g, '') ?? ''}`;
	return {
		value: Number(number),
		style: {
			float,
			hex: false,
			upper: false,
			digits: fraction ? fraction.replace(/_/g, '').length : 0,
			groups: [],
			suffix,
			trailingDot: dot !== undefined && fraction === undefined && suffix === '',
		},
	};
}

/**
 * Writes `value` in `style`. Floats get at least `precision` decimals (fewer
 * when the trailing ones are zero), so a picked colour isn't rounded away.
 */
export function formatNumber(value: number, style: NumberStyle, precision: number): string {
	if (!style.float) {
		const integer = Math.max(0, Math.round(value));
		if (!style.hex) {
			return `${integer}${style.suffix}`;
		}
		let digits = integer.toString(16).padStart(style.digits, '0');
		digits = style.upper ? digits.toUpperCase() : digits;
		return `0x${regroup(digits, style.groups)}${style.suffix}`;
	}
	const minDecimals = style.trailingDot ? 0 : Math.max(1, style.digits);
	const maxDecimals = Math.max(precision, style.digits);
	let text = (Object.is(value, -0) ? 0 : value).toFixed(maxDecimals);
	while (text.includes('.') && text.split('.')[1].length > minDecimals && text.endsWith('0')) {
		text = text.slice(0, -1);
	}
	if (text.endsWith('.')) {
		text = style.trailingDot ? text : `${text}0`;
	}
	return `${text}${style.suffix}`;
}

function underscorePositions(written: string): number[] {
	const positions: number[] = [];
	let digitsFromRight = 0;
	for (let index = written.length - 1; index >= 0; index--) {
		if (written[index] === '_') {
			positions.push(digitsFromRight);
		} else {
			digitsFromRight++;
		}
	}
	return positions;
}

/** Puts `_` back between hex digits, as in `0xAE_F9_58`, when the digit count allows it. */
function regroup(digits: string, groups: readonly number[]): string {
	if (groups.length === 0) {
		return digits;
	}
	let result = '';
	for (let index = digits.length - 1, fromRight = 0; index >= 0; index--, fromRight++) {
		if (fromRight > 0 && groups.includes(fromRight)) {
			result = '_' + result;
		}
		result = digits[index] + result;
	}
	return result;
}
