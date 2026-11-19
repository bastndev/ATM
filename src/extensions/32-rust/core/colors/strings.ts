import { isPunct, Token } from '../lexer';
import type { ColorPresentation } from './calls';
import { clamp01, hslToRgb, Rgba, rgbToHsl, toByte } from './rgba';

/**
 * Colours written inside Rust strings:
 *
 * - The whole string is a hex colour: `"#aef958"` (egui's `from_hex`,
 *   `hex_color!`, iced's `Color::parse`, css-color crates…). The `#` may be
 *   left out in a hex function's argument, as `Srgba::hex("aef958")` allows.
 * - CSS in a string, as in Dioxus and Leptos styles:
 *   `"color: #fff; border: 1px solid rgb(0, 0, 0)"`.
 *
 * A `#123` in ordinary text ("Fix #123") is not a colour: inside longer
 * strings, hex only counts when the string reads as CSS.
 */

interface HexForm {
	type: 'hex';
	hash: boolean;
	upper: boolean;
	/** 3, 4, 6 or 8. */
	digits: number;
}

interface CssForm {
	type: 'css';
	space: 'rgb' | 'hsl';
	/** The function name as written: rgb, rgba, hsl, hsla (any case). */
	name: string;
	/** `rgb(1, 2, 3)` rather than `rgb(1 2 3)`. */
	commas: boolean;
	/** The alpha was written, and as a percentage. */
	alpha: boolean;
	alphaPercent: boolean;
}

export interface StringMatch {
	kind: 'string';
	start: number;
	end: number;
	color: Rgba;
	form: HexForm | CssForm;
}

/** Functions whose string argument is a hex colour, with or without `#`. */
const HEX_FUNCTIONS = new Set(['from_hex', 'hex', 'from_hex_str', 'try_from_hex', 'parse_hex', 'hex_color']);

const HEX_ONLY = /^(#?)([0-9a-fA-F]+)$/;
const HEX_IN_CSS = /(^|[\s:(,])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))(?![\w-])/g;
const CSS_FUNCTION = /(^|[^\w-])((?:rgb|hsl)a?)\(([^()]*)\)/gi;
/** A CSS declaration (`color:`, `border-top:`). Property names are lower case, so "Error:" isn't one. */
const CSS_DECLARATION = /(^|[;{\s])[a-z][a-z-]*\s*:/;

/** Colours in the string token at tokens[index]. */
export function findStringColors(tokens: readonly Token[], index: number): StringMatch[] {
	const token = tokens[index];
	const bounds = contentBounds(token);
	if (!bounds) {
		return [];
	}
	const content = token.text.slice(bounds.start - token.start, bounds.end - token.start);

	const whole = parseHex(content, isHexArgument(tokens, index));
	if (whole) {
		return [{ kind: 'string', start: bounds.start, end: bounds.end, ...whole }];
	}

	const matches: StringMatch[] = [];
	for (const found of content.matchAll(CSS_FUNCTION)) {
		const parsed = parseCssFunction(found[2], found[3]);
		if (parsed && found.index !== undefined) {
			const start = bounds.start + found.index + found[1].length;
			matches.push({ kind: 'string', start, end: start + found[0].length - found[1].length, ...parsed });
		}
	}
	if (CSS_DECLARATION.test(content)) {
		for (const found of content.matchAll(HEX_IN_CSS)) {
			const parsed = parseHex(found[2], false);
			if (parsed && found.index !== undefined) {
				const start = bounds.start + found.index + found[1].length;
				matches.push({ kind: 'string', start, end: start + found[2].length, ...parsed });
			}
		}
	}
	return matches.sort((a, b) => a.start - b.start);
}

/** Where the text between the quotes is: plain and raw strings only (not b"…" bytes). */
function contentBounds(token: Token): { start: number; end: number } | undefined {
	const prefix = token.prefix ?? '';
	if (prefix !== '' && prefix !== 'r') {
		return undefined;
	}
	const hashes = prefix === 'r' ? /^#*/.exec(token.text.slice(1))![0].length : 0;
	const open = prefix.length + hashes + 1;
	const close = '"' + '#'.repeat(hashes);
	if (token.text.length < open + close.length || !token.text.endsWith(close)) {
		return undefined;
	}
	return { start: token.start + open, end: token.end - close.length };
}

/** The string is the argument of `from_hex(…)`, `Srgba::hex(…)` or `hex_color!(…)`. */
function isHexArgument(tokens: readonly Token[], index: number): boolean {
	if (!isPunct(tokens[index - 1], '(')) {
		return false;
	}
	const name = isPunct(tokens[index - 2], '!') ? tokens[index - 3] : tokens[index - 2];
	return name?.kind === 'ident' && HEX_FUNCTIONS.has(name.text);
}

function parseHex(text: string, hashOptional: boolean): { color: Rgba; form: HexForm } | undefined {
	const match = HEX_ONLY.exec(text);
	if (!match || (!match[1] && !hashOptional)) {
		return undefined;
	}
	const digits = match[2];
	if (![3, 4, 6, 8].includes(digits.length)) {
		return undefined;
	}
	const long = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
	const byte = (index: number) => parseInt(long.slice(index * 2, index * 2 + 2), 16) / 255;
	return {
		color: { r: byte(0), g: byte(1), b: byte(2), a: long.length === 8 ? byte(3) : 1 },
		form: { type: 'hex', hash: match[1] === '#', upper: /[A-F]/.test(digits) && !/[a-f]/.test(digits), digits: digits.length },
	};
}

function parseCssFunction(name: string, inside: string): { color: Rgba; form: CssForm } | undefined {
	const space = name.toLowerCase().startsWith('hsl') ? 'hsl' : 'rgb';
	const commas = inside.includes(',');
	let parts: string[];
	let alphaText: string | undefined;
	if (commas) {
		parts = inside.split(',').map((part) => part.trim());
		alphaText = parts.length === 4 ? parts.pop() : undefined;
	} else {
		const [main, alpha, extra] = inside.split('/');
		if (extra !== undefined) {
			return undefined;
		}
		parts = main.trim().split(/\s+/);
		alphaText = alpha?.trim();
	}
	if (parts.length !== 3) {
		return undefined;
	}
	const alpha = alphaText === undefined ? 1 : cssUnit(alphaText, 1);
	if (alpha === undefined) {
		return undefined;
	}

	let channels: number[] | undefined;
	if (space === 'rgb') {
		const values = parts.map((part) => cssUnit(part, 255));
		channels = values.every((value) => value !== undefined) ? (values as number[]) : undefined;
	} else {
		const hue = /^(-?\d*\.?\d+)(deg)?$/.exec(parts[0]);
		const saturation = /%$/.test(parts[1]) ? cssUnit(parts[1], 1) : undefined;
		const lightness = /%$/.test(parts[2]) ? cssUnit(parts[2], 1) : undefined;
		channels = hue && saturation !== undefined && lightness !== undefined ? hslToRgb(Number(hue[1]) / 360, saturation, lightness) : undefined;
	}
	if (!channels) {
		return undefined;
	}
	return {
		color: { r: channels[0], g: channels[1], b: channels[2], a: alpha },
		form: { type: 'css', space, name, commas, alpha: alphaText !== undefined, alphaPercent: alphaText?.endsWith('%') ?? false },
	};
}

/** A CSS number or percentage as 0–1; `max` is what a plain number means as 100%. */
function cssUnit(text: string, max: number): number | undefined {
	const match = /^(\d*\.?\d+)(%?)$/.exec(text);
	if (!match) {
		return undefined;
	}
	const value = Number(match[1]) / (match[2] ? 100 : max);
	return value >= 0 && value <= 1 ? value : undefined;
}

// ── Writing ────────────────────────────────────────────────────────────────

/** The picker's choices for a colour in a string, the current form first. */
export function presentString(match: StringMatch, color: Rgba): ColorPresentation[] {
	const choices: string[] = [];
	const add = (text: string) => {
		if (!choices.includes(text)) {
			choices.push(text);
		}
	};
	const { form } = match;
	if (form.type === 'hex') {
		add(writeHex(color, form));
		// Offer the long form after a short one (#fff → #ffffff).
		add(writeHex(color, { ...form, digits: form.digits <= 4 ? form.digits * 2 : form.digits }));
	} else {
		add(writeCss(color, form));
		add(writeHex(color, { type: 'hex', hash: true, upper: false, digits: 6 }));
		add(writeCss(color, { ...form, space: form.space === 'rgb' ? 'hsl' : 'rgb', name: form.space === 'rgb' ? 'hsl' : 'rgb' }));
	}
	return choices.map((text) => ({ label: text, text }));
}

function writeHex(color: Rgba, form: HexForm): string {
	const bytes = [toByte(color.r), toByte(color.g), toByte(color.b), toByte(color.a)];
	const withAlpha = bytes[3] < 255 || form.digits === 4 || form.digits === 8;
	const used = withAlpha ? bytes : bytes.slice(0, 3);
	// Short form only when every byte is a doubled digit (0xaa → a).
	const short = form.digits <= 4 && used.every((byte) => byte % 17 === 0);
	let digits = used.map((byte) => (short ? (byte / 17).toString(16) : byte.toString(16).padStart(2, '0'))).join('');
	digits = form.upper ? digits.toUpperCase() : digits;
	return `${form.hash ? '#' : ''}${digits}`;
}

function writeCss(color: Rgba, form: CssForm): string {
	const alphaNeeded = toByte(color.a) < 255 || form.alpha;
	const alpha = form.alphaPercent ? `${Math.round(clamp01(color.a) * 100)}%` : `${Number(clamp01(color.a).toFixed(2))}`;
	let values: string[];
	if (form.space === 'rgb') {
		values = [color.r, color.g, color.b].map((channel) => `${toByte(channel)}`);
	} else {
		const [hue, saturation, lightness] = rgbToHsl(color.r, color.g, color.b);
		values = [`${Math.round(hue * 360)}`, `${Math.round(saturation * 100)}%`, `${Math.round(lightness * 100)}%`];
	}
	if (form.commas) {
		// The old comma syntax takes a fourth number only in rgba()/hsla().
		const upper = form.name === form.name.toUpperCase();
		const name = alphaNeeded && !/a$/i.test(form.name) ? form.name + (upper ? 'A' : 'a') : form.name;
		return `${name}(${[...values, ...(alphaNeeded ? [alpha] : [])].join(', ')})`;
	}
	return `${form.name}(${values.join(' ')}${alphaNeeded ? ` / ${alpha}` : ''})`;
}
