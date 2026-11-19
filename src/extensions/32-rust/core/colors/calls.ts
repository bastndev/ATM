import { isPunct, Token } from '../lexer';
import { ColorFormat, eguiConstantFor, formatById, formatsNamed, Slot } from './formats';
import { formatNumber, NumberLiteral, NumberStyle, parseNumber, plainStyle } from './literals';
import { clamp01, hslToRgb, linearToSrgb, Rgba, rgbToHsl, srgbToLinear, toByte } from './rgba';

/**
 * Finds colour constructors in Rust code (`Color32::from_rgb(10, 130, 20)`,
 * `rgb(0xaef958)`, `Color::Rgb { r: 1, g: 2, b: 3 }`…) and writes a picked
 * colour back in the same style. Only literal numbers count: a call with a
 * variable has no colour to show.
 */

/** One number argument: `10`, `0.5f32`, or `210.0 / 360.0`. */
export interface NumberArg {
	/** The number the colour picker rewrites (the numerator of a division). */
	start: number;
	end: number;
	literal: NumberLiteral;
	/** `/ 360.0`: kept as written, only the numerator changes. */
	divisor?: NumberLiteral;
	value: number;
	float: boolean;
}

export interface CallMatch {
	kind: 'call';
	format: ColorFormat;
	/** The whole expression, path included (`egui::Color32::from_rgb(…)`). */
	start: number;
	end: number;
	/** Where the name starts; the text before it (`egui::Color32::`) is kept as written. */
	nameStart: number;
	/** In the format's slot order. */
	args: NumberArg[];
	color: Rgba;
	/** Index of the last token, so scanning continues after it. */
	lastToken: number;
}

export interface ColorPresentation {
	/** Shown in the picker's header. */
	label: string;
	/** What replaces the colour's range. */
	text: string;
}

/** Keywords that start a definition, not a call: `fn rgb(…)`, `struct RGBColor(…)`. */
const DEFINITIONS = new Set(['fn', 'struct', 'enum', 'type', 'trait', 'mod', 'macro_rules']);

/** Colour calls whose name token lies in tokens[from, to). */
export function findCallColors(tokens: readonly Token[], from = 0, to = tokens.length): CallMatch[] {
	const matches: CallMatch[] = [];
	for (let index = from; index < to; index++) {
		const token = tokens[index];
		if (token.kind !== 'ident') {
			continue;
		}
		const candidates = formatsNamed(token.text);
		if (candidates.length === 0) {
			continue;
		}
		const match = matchAt(tokens, index, candidates);
		if (match) {
			matches.push(match);
			index = match.lastToken;
		}
	}
	return matches;
}

type Shape = 'call' | 'macro' | 'array' | 'struct' | 'constant';

function matchAt(tokens: readonly Token[], index: number, candidates: readonly ColorFormat[]): CallMatch | undefined {
	const name = tokens[index];
	const previous = tokens[index - 1];

	// What comes before the name: `.name`, `Owner::name`, `module::name` or nothing.
	let context: 'method' | 'owner' | 'free' = 'free';
	let owner: string | undefined;
	let start = name.start;
	if (isPunct(previous, '.')) {
		context = 'method';
	} else if (isPunct(previous, '::') && tokens[index - 2]?.kind === 'ident') {
		const path = tokens[index - 2].text;
		context = /^[A-Z]/.test(path) ? 'owner' : 'free';
		owner = context === 'owner' ? path : undefined;
		start = pathStart(tokens, index - 2);
	} else if (previous?.kind === 'ident' && DEFINITIONS.has(previous.text)) {
		return undefined;
	}

	// What comes after: `(`, `([`, `!(`, `{`, or nothing (a constant).
	const next = tokens[index + 1];
	let shape: Shape;
	let open = index + 1;
	if (isPunct(next, '!') && isPunct(tokens[index + 2], '(')) {
		shape = 'macro';
		open = index + 2;
	} else if (isPunct(next, '(') && isPunct(tokens[index + 2], '[')) {
		shape = 'array';
		open = index + 2;
	} else if (isPunct(next, '(')) {
		shape = 'call';
	} else if (isPunct(next, '{')) {
		shape = 'struct';
	} else if (context === 'owner' && !isPunct(next, '::') && !isPunct(next, '!')) {
		shape = 'constant';
	} else {
		return undefined;
	}

	const formats = candidates.filter((format) => fits(format, context, owner, shape));
	if (formats.length === 0) {
		return undefined;
	}
	if (shape === 'constant') {
		const format = formats[0];
		return { kind: 'call', format, start, end: name.end, nameStart: name.start, args: [], color: decode(format, [])!, lastToken: index };
	}

	const read = shape === 'struct' ? readFields(tokens, open) : readArgs(tokens, open, shape === 'array' ? ']' : ')');
	if (!read) {
		return undefined;
	}
	let last = read.close;
	if (shape === 'array') {
		if (!isPunct(tokens[last + 1], ')')) {
			return undefined;
		}
		last++;
	}
	for (const format of formats) {
		const args = shape === 'struct' ? orderFields(format, read.args) : read.args;
		const color = args && decode(format, args);
		if (args && color) {
			return { kind: 'call', format, start: context === 'method' ? name.start : start, end: tokens[last].end, nameStart: name.start, args, color, lastToken: last };
		}
	}
	return undefined;
}

function fits(format: ColorFormat, context: 'method' | 'owner' | 'free', owner: string | undefined, shape: Shape): boolean {
	if (context === 'method') {
		return format.syntax === 'method' && shape === 'call';
	}
	if (context === 'owner') {
		return format.owners !== undefined && owner !== undefined && format.owners.includes(owner) && format.syntax === shape;
	}
	return format.owners === undefined && format.syntax !== 'method' && format.syntax === shape;
}

/** Goes back over `a::b::` before a path segment, and a leading `::`. */
function pathStart(tokens: readonly Token[], index: number): number {
	let first = index;
	while (isPunct(tokens[first - 1], '::') && tokens[first - 2]?.kind === 'ident') {
		first -= 2;
	}
	return isPunct(tokens[first - 1], '::') ? tokens[first - 1].start : tokens[first].start;
}

type ReadArg = NumberArg & { field?: string };

/** `(1, 2, 3)` from the opening token; every argument must be a number or `number / number`. */
function readArgs(tokens: readonly Token[], open: number, closer: string): { args: ReadArg[]; close: number } | undefined {
	const args: ReadArg[] = [];
	let index = open + 1;
	while (index < tokens.length) {
		if (isPunct(tokens[index], closer)) {
			return { args, close: index };
		}
		const arg = readNumberArg(tokens, index);
		if (!arg) {
			return undefined;
		}
		args.push(arg.arg);
		index = arg.next;
		if (isPunct(tokens[index], ',')) {
			index++;
		} else if (!isPunct(tokens[index], closer)) {
			return undefined;
		}
	}
	return undefined;
}

/** `{ r: 1, g: 2, b: 3 }` from the `{`. */
function readFields(tokens: readonly Token[], open: number): { args: ReadArg[]; close: number } | undefined {
	const args: ReadArg[] = [];
	let index = open + 1;
	while (index < tokens.length) {
		if (isPunct(tokens[index], '}')) {
			return { args, close: index };
		}
		const field = tokens[index];
		if (field.kind !== 'ident' || !isPunct(tokens[index + 1], ':')) {
			return undefined;
		}
		const arg = readNumberArg(tokens, index + 2);
		if (!arg) {
			return undefined;
		}
		args.push({ ...arg.arg, field: field.text });
		index = arg.next;
		if (isPunct(tokens[index], ',')) {
			index++;
		} else if (!isPunct(tokens[index], '}')) {
			return undefined;
		}
	}
	return undefined;
}

function orderFields(format: ColorFormat, fields: ReadArg[]): ReadArg[] | undefined {
	if (fields.length !== format.slots.length) {
		return undefined;
	}
	const ordered = format.slots.map((slot) => fields.find((field) => field.field === slot.channel));
	return ordered.every((field) => field !== undefined) ? (ordered as ReadArg[]) : undefined;
}

function readNumberArg(tokens: readonly Token[], index: number): { arg: ReadArg; next: number } | undefined {
	const first = tokens[index];
	const literal = first?.kind === 'number' ? parseNumber(first.text) : undefined;
	if (!literal) {
		return undefined;
	}
	const arg: ReadArg = { start: first.start, end: first.end, literal, value: literal.value, float: literal.style.float };
	if (isPunct(tokens[index + 1], '/') && tokens[index + 2]?.kind === 'number') {
		const divisor = parseNumber(tokens[index + 2].text);
		if (!divisor || divisor.value === 0) {
			return undefined;
		}
		const float = literal.style.float || divisor.style.float;
		// Integer division truncates in Rust.
		arg.value = float ? literal.value / divisor.value : Math.trunc(literal.value / divisor.value);
		arg.divisor = divisor;
		arg.float = float;
		return { arg, next: index + 3 };
	}
	return { arg, next: index + 1 };
}

// ── Numbers ↔ colour ───────────────────────────────────────────────────────

type Scale = 'byte' | 'unit';

function slotScale(slot: Slot, float: boolean): Scale {
	return slot.scale ?? (float ? 'unit' : 'byte');
}

function isLinear(format: ColorFormat): boolean {
	return format.encoding === 'linear' || format.encoding === 'linear-premultiplied';
}

function isPremultiplied(format: ColorFormat): boolean {
	return format.encoding === 'premultiplied' || format.encoding === 'linear-premultiplied';
}

function hasAlpha(format: ColorFormat): boolean {
	return format.value !== undefined || format.slots.some((slot) => slot.channel === 'a' || slot.channel === 'rgba32' || slot.channel === 'argb32');
}

/** The colour the numbers stand for, or undefined when they are out of range. */
export function decode(format: ColorFormat, args: readonly NumberArg[]): Rgba | undefined {
	if (format.value) {
		const [r, g, b, a] = format.value.map((channel) => channel / 255);
		return finish(format, r, g, b, a);
	}
	if (args.length !== format.slots.length) {
		return undefined;
	}
	let [r, g, b, a] = format.fixed ? [format.fixed.r / 255, format.fixed.g / 255, format.fixed.b / 255, 1] : [0, 0, 0, 1];
	let hsl: [number, number, number] | undefined;
	for (const [index, slot] of format.slots.entries()) {
		const arg = args[index];
		switch (slot.channel) {
			case 'rgb24':
			case 'rgba32':
			case 'argb32': {
				// A packed colour is always written in hex; a decimal number there is something else.
				if (!arg.literal.style.hex || arg.divisor) {
					return undefined;
				}
				const bytes = unpack(slot.channel, arg.value);
				if (!bytes) {
					return undefined;
				}
				[r, g, b] = bytes.slice(0, 3).map((byte) => byte / 255);
				a = bytes.length === 4 ? bytes[3] / 255 : a;
				break;
			}
			case 'h':
				hsl ??= [0, 0, 0];
				hsl[0] = format.hue === 'degrees' ? arg.value / 360 : arg.value;
				break;
			case 's':
			case 'l':
				if (arg.value < 0 || arg.value > 1) {
					return undefined;
				}
				hsl ??= [0, 0, 0];
				hsl[slot.channel === 's' ? 1 : 2] = arg.value;
				break;
			default: {
				const max = slotScale(slot, arg.float) === 'byte' ? 255 : 1;
				if (arg.value < 0 || arg.value > max) {
					return undefined;
				}
				const unit = arg.value / max;
				if (slot.channel === 'gray') {
					r = g = b = unit;
				} else if (slot.channel === 'r') {
					r = unit;
				} else if (slot.channel === 'g') {
					g = unit;
				} else if (slot.channel === 'b') {
					b = unit;
				} else {
					a = unit;
				}
			}
		}
	}
	if (hsl) {
		[r, g, b] = hslToRgb(hsl[0], hsl[1], hsl[2]);
	}
	return finish(format, r, g, b, a);
}

/** From the format's own space (linear, premultiplied) to what the picker shows. */
function finish(format: ColorFormat, r: number, g: number, b: number, a: number): Rgba {
	let channels = [r, g, b];
	if (isPremultiplied(format)) {
		channels = channels.map((channel) => (a > 0 ? channel / a : 0));
	}
	if (isLinear(format)) {
		channels = channels.map((channel) => linearToSrgb(clamp01(channel)));
	}
	return { r: clamp01(channels[0]), g: clamp01(channels[1]), b: clamp01(channels[2]), a: clamp01(a) };
}

function unpack(packed: 'rgb24' | 'rgba32' | 'argb32', value: number): number[] | undefined {
	const byte = (shift: number) => Math.floor(value / 2 ** shift) % 256;
	if (packed === 'rgb24') {
		return value <= 0xffffff ? [byte(16), byte(8), byte(0)] : undefined;
	}
	if (value > 0xffffffff) {
		return undefined;
	}
	return packed === 'rgba32' ? [byte(24), byte(16), byte(8), byte(0)] : [byte(16), byte(8), byte(0), byte(24)];
}

/**
 * The numbers that write `color` in `format`, slot by slot, or undefined
 * when the format can't hold it (transparency without an alpha slot, a
 * non-grey colour in `from_gray`…). `floats` says, per slot, whether the
 * number will be written as a float, which decides its scale.
 */
export function encode(format: ColorFormat, color: Rgba, floats: readonly boolean[]): number[] | undefined {
	const bytes = [toByte(color.r), toByte(color.g), toByte(color.b), toByte(color.a)];
	if (!hasAlpha(format) && bytes[3] < 255) {
		return undefined;
	}
	if (format.value) {
		return encodeConstant(format, color) ? [] : undefined;
	}
	if (format.fixed && (bytes[0] !== format.fixed.r || bytes[1] !== format.fixed.g || bytes[2] !== format.fixed.b)) {
		return undefined;
	}
	if (format.slots.some((slot) => slot.channel === 'gray') && !(bytes[0] === bytes[1] && bytes[1] === bytes[2])) {
		return undefined;
	}

	const alpha = hasAlpha(format) ? color.a : 1;
	let [r, g, b] = [color.r, color.g, color.b];
	if (isLinear(format)) {
		[r, g, b] = [r, g, b].map(srgbToLinear);
	}
	if (isPremultiplied(format)) {
		[r, g, b] = [r, g, b].map((channel) => channel * alpha);
	}
	const [hue, saturation, lightness] = rgbToHsl(color.r, color.g, color.b);
	const units: Record<'r' | 'g' | 'b' | 'a' | 'gray', number> = { r, g, b, a: alpha, gray: r };

	return format.slots.map((slot, index) => {
		switch (slot.channel) {
			case 'rgb24':
				return (bytes[0] * 256 + bytes[1]) * 256 + bytes[2];
			case 'rgba32':
				return ((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3];
			case 'argb32':
				return ((bytes[3] * 256 + bytes[0]) * 256 + bytes[1]) * 256 + bytes[2];
			case 'h':
				return format.hue === 'degrees' ? hue * 360 : hue;
			case 's':
				return saturation;
			case 'l':
				return lightness;
			default: {
				const unit = clamp01(units[slot.channel]);
				return slotScale(slot, floats[index]) === 'byte' ? Math.round(unit * 255) : unit;
			}
		}
	});
}

function encodeConstant(format: ColorFormat, color: Rgba): boolean {
	const own = decode(format, []);
	return own !== undefined && [own.r, own.g, own.b, own.a].every((channel, index) => toByte(channel) === toByte([color.r, color.g, color.b, color.a][index]));
}

// ── Writing ────────────────────────────────────────────────────────────────

/** Decimals for floats: 0–1 values need 3 to keep 8-bit precision; degrees need 1. */
function precisionFor(format: ColorFormat, slot: Slot, scale: Scale, divided: boolean): number {
	if (divided || (slot.channel === 'h' && format.hue === 'degrees')) {
		return 1;
	}
	return scale === 'byte' ? 0 : 3;
}

/** The picker's choices for a call, the current format first. */
export function presentCall(match: CallMatch, color: Rgba, original: string): ColorPresentation[] {
	const prefix = original.slice(0, match.nameStart - match.start);
	const choices: ColorPresentation[] = [];
	const add = (choice: ColorPresentation | undefined) => {
		if (choice && !choices.some((existing) => existing.text === choice.text)) {
			choices.push(choice);
		}
	};
	const write = (format: ColorFormat, target: Rgba) =>
		format === match.format ? writeSame(match, target, original, prefix) : writeOther(format, match, target, prefix);
	const writeById = (id: string) => {
		const format = formatById(id);
		return format && write(format, color);
	};

	const same = write(match.format, color);
	add(same);
	// Transparency the format can't hold: its alpha twin comes first (from_rgb → from_rgba_unmultiplied).
	if (!same && toByte(color.a) < 255 && match.format.withAlpha) {
		add(writeById(match.format.withAlpha));
	}
	for (const id of match.format.alternatives ?? []) {
		add(writeById(id));
	}
	if (match.format.owners?.includes('Color32')) {
		const constant = eguiConstantFor([toByte(color.r), toByte(color.g), toByte(color.b), toByte(color.a)]);
		add(constant && writeOther(constant, match, color, prefix));
	}
	if (choices.length === 0) {
		// The format has no alpha and nothing to switch to: keep the colour, drop the transparency.
		add(write(match.format, { ...color, a: 1 }));
	}
	return choices;
}

/** The same format: only the numbers change, so spacing, line breaks and suffixes stay. */
function writeSame(match: CallMatch, color: Rgba, original: string, prefix: string): ColorPresentation | undefined {
	const { format } = match;
	if (format.syntax === 'constant') {
		return encode(format, color, []) ? { label: labelFor(format, prefix, ''), text: original } : undefined;
	}
	const values = encode(format, color, match.args.map((arg) => arg.float));
	if (!values) {
		return undefined;
	}
	const numbers = match.args.map((arg, index) => {
		const slot = format.slots[index];
		const scale = slotScale(slot, arg.float);
		const value = arg.divisor ? values[index] * arg.divisor.value : values[index];
		return formatNumber(value, arg.literal.style, precisionFor(format, slot, scale, arg.divisor !== undefined));
	});
	// Replace from the end so earlier offsets stay valid.
	let text = original;
	const order = match.args.map((arg, index) => ({ arg, index })).sort((a, b) => b.arg.start - a.arg.start);
	for (const { arg, index } of order) {
		text = text.slice(0, arg.start - match.start) + numbers[index] + text.slice(arg.end - match.start);
	}
	const shown = match.args.map((arg, index) => (arg.divisor ? `${numbers[index]} / ${formatNumber(arg.divisor.value, arg.divisor.style, 1)}` : numbers[index]));
	return { label: labelFor(format, prefix, shown.join(', ')), text };
}

/** Another format of the same library, written the plain way. */
function writeOther(format: ColorFormat, match: CallMatch, color: Rgba, prefix: string): ColorPresentation | undefined {
	if (format.syntax === 'constant') {
		return encode(format, color, []) ? { label: labelFor(format, prefix, ''), text: prefix + format.name } : undefined;
	}
	const styles = format.slots.map((slot) => styleFor(slot, match));
	const values = encode(format, color, styles.map((style) => style.float));
	if (!values) {
		return undefined;
	}
	const numbers = values.map((value, index) => {
		const slot = format.slots[index];
		return formatNumber(value, styles[index], precisionFor(format, slot, slotScale(slot, styles[index].float), false));
	});
	return { label: labelFor(format, prefix, numbers.join(', ')), text: render(format, prefix, numbers) };
}

/** How to write a number the user hasn't written yet. */
function styleFor(slot: Slot, match: CallMatch): NumberStyle {
	if (slot.channel === 'rgb24' || slot.channel === 'rgba32' || slot.channel === 'argb32') {
		const upper = match.args.some((arg) => arg.literal.style.hex && arg.literal.style.upper);
		return { ...plainStyle(false), hex: true, upper, digits: slot.channel === 'rgb24' ? 6 : 8 };
	}
	if (slot.number) {
		return plainStyle(slot.number === 'float');
	}
	// Shared names: follow the user's numbers (ints stay ints, floats stay floats).
	const sameChannel = match.args.find((_, index) => match.format.slots[index]?.channel === slot.channel);
	const reference = sameChannel ?? match.args.find((arg) => !arg.literal.style.hex) ?? match.args[0];
	return plainStyle(reference?.float ?? false);
}

function render(format: ColorFormat, prefix: string, numbers: readonly string[]): string {
	const args = numbers.join(', ');
	switch (format.syntax) {
		case 'macro':
			return `${prefix}${format.name}!(${args})`;
		case 'array':
			return `${prefix}${format.name}([${args}])`;
		case 'struct':
			return `${prefix}${format.name} { ${format.slots.map((slot, index) => `${slot.channel}: ${numbers[index]}`).join(', ')} }`;
		default:
			return `${prefix}${format.name}(${args})`;
	}
}

/** The header text: the call without its module path (`Color32::from_rgb(…)`, not `egui::Color32::…`). */
function labelFor(format: ColorFormat, prefix: string, args: string): string {
	const owner = prefix
		.split('::')
		.filter((segment) => /^[A-Z]/.test(segment))
		.map((segment) => `${segment}::`)
		.join('');
	if (format.syntax === 'constant') {
		return `${owner}${format.name}`;
	}
	if (format.syntax === 'method') {
		return `.${format.name}(${args})`;
	}
	if (format.syntax === 'struct') {
		const values = args.split(', ');
		return `${owner}${format.name} { ${format.slots.map((slot, index) => `${slot.channel}: ${values[index]}`).join(', ')} }`;
	}
	return render(format, owner, args.length > 0 ? args.split(', ') : []);
}
