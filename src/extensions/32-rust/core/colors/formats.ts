/**
 * Every Rust colour constructor ATM recognises, as data. Adding a library
 * is adding rows here; the matcher (calls.ts) and the picker need no change.
 *
 * Number scale: unless a slot says otherwise, an integer literal is 0–255
 * and a float literal is 0–1. Rust never turns `1` into `1.0` by itself, so
 * the literal tells which scale a library uses even when two libraries
 * share a name, like `Color::from_rgb` (u8 in ggez and fltk, f32 in iced).
 */

/** r, g, b, a: colour channels; gray: all three at once; h, s, l: HSL. */
export type Channel = 'r' | 'g' | 'b' | 'a' | 'gray' | 'h' | 's' | 'l';
/** One hex number holding every channel: 0xRRGGBB, 0xRRGGBBAA or 0xAARRGGBB. */
export type Packed = 'rgb24' | 'rgba32' | 'argb32';

export interface Slot {
	channel: Channel | Packed;
	/** The literal kind the library takes, used when ATM writes this format for the first time. Unset: like the user's other numbers. */
	number?: 'int' | 'float';
	/** Fixed scale whatever the literal (iced's `color!(255.0, 0.0, 0.0)` is still 0–255). */
	scale?: 'byte' | 'unit';
}

export type Syntax =
	/** `Owner::name(…)`, or `name(…)` without owner: free function or tuple struct. */
	| 'call'
	/** `name!(…)`. */
	| 'macro'
	/** `value.name(…)`. */
	| 'method'
	/** `Name([…])` or `Owner::name([…])`. */
	| 'array'
	/** `Owner::Name { r: …, g: …, b: … }`. */
	| 'struct'
	/** `Owner::NAME`. */
	| 'constant';

export interface ColorFormat {
	/** `owner.name/slot-count`, or a readable name for constants. */
	id: string;
	/** Who uses it; for readers and tests. */
	libraries: string;
	syntax: Syntax;
	/** The type before `::`; undefined for free functions, tuple structs, macros and methods. */
	owners?: readonly string[];
	name: string;
	slots: readonly Slot[];
	/** How the numbers relate to the colour on screen. Default: sRGB, alpha not premultiplied. */
	encoding?: 'srgb' | 'linear' | 'premultiplied' | 'linear-premultiplied';
	/** Unit of h: degrees (0–360) or a fraction of a turn (0–1). */
	hue?: 'degrees' | 'unit';
	/** Channels this format can't change, as 0–255 values (`from_black_alpha` is always black). */
	fixed?: { r: number; g: number; b: number };
	/** A constant's value, 0–255 per channel, alpha premultiplied when `encoding` says so. */
	value?: readonly [number, number, number, number];
	/** Same-library formats offered in the picker (click its header to switch), by id. */
	alternatives?: readonly string[];
	/** Where to switch when the picked colour is transparent and this format has no alpha. */
	withAlpha?: string;
}

const slots = (number: Slot['number'] | undefined, ...channels: Array<Channel | Packed>): Slot[] =>
	channels.map((channel) => (number ? { channel, number } : { channel }));
/** Integer channels (u8). */
const ints = (...channels: Array<Channel | Packed>) => slots('int', ...channels);
/** Float channels (f32/f64). */
const floats = (...channels: Array<Channel | Packed>) => slots('float', ...channels);
/** The literal decides (several libraries share the name with different types). */
const auto = (...channels: Array<Channel | Packed>) => slots(undefined, ...channels);

function call(
	libraries: string,
	owners: readonly string[] | undefined,
	name: string,
	slotList: Slot[],
	extra: Partial<ColorFormat> = {},
): ColorFormat {
	return { id: formatId(owners, name, slotList.length), libraries, syntax: 'call', owners, name, slots: slotList, ...extra };
}

export function formatId(owners: readonly string[] | undefined, name: string, slotCount: number): string {
	return `${owners?.[0] ?? ''}.${name}/${slotCount}`;
}

const COLOR = ['Color'];
const COLOR32 = ['Color32'];
const EGUI_RGBA = ['Rgba'];

/** egui's named colours, from ecolor 0.37 (color32.rs). */
const EGUI_CONSTANTS: ReadonlyArray<readonly [string, number, number, number, number]> = [
	['TRANSPARENT', 0, 0, 0, 0],
	['BLACK', 0, 0, 0, 255],
	['DARK_GRAY', 96, 96, 96, 255],
	['GRAY', 160, 160, 160, 255],
	['LIGHT_GRAY', 220, 220, 220, 255],
	['WHITE', 255, 255, 255, 255],
	['BROWN', 165, 42, 42, 255],
	['DARK_RED', 0x8b, 0, 0, 255],
	['RED', 255, 0, 0, 255],
	['LIGHT_RED', 255, 128, 128, 255],
	['CYAN', 0, 255, 255, 255],
	['MAGENTA', 255, 0, 255, 255],
	['YELLOW', 255, 255, 0, 255],
	['ORANGE', 255, 165, 0, 255],
	['LIGHT_YELLOW', 255, 255, 0xe0, 255],
	['KHAKI', 240, 230, 140, 255],
	['DARK_GREEN', 0, 0x64, 0, 255],
	['GREEN', 0, 255, 0, 255],
	['LIGHT_GREEN', 0x90, 0xee, 0x90, 255],
	['DARK_BLUE', 0, 0, 0x8b, 255],
	['BLUE', 0, 0, 255, 255],
	['LIGHT_BLUE', 0xad, 0xd8, 0xe6, 255],
	['PURPLE', 0x80, 0, 0x80, 255],
	['GOLD', 255, 215, 0, 255],
	// Premultiplied, like egui defines them.
	['DEBUG_COLOR', 0, 200, 0, 128],
	['PLACEHOLDER', 64, 254, 0, 128],
];
const PREMULTIPLIED_CONSTANTS = new Set(['DEBUG_COLOR', 'PLACEHOLDER']);

const EGUI_FROM_RGB = formatId(COLOR32, 'from_rgb', 3);
const EGUI_UNMULTIPLIED = formatId(COLOR32, 'from_rgba_unmultiplied', 4);
const EGUI_GRAY = formatId(COLOR32, 'from_gray', 1);
const EGUI_CHOICES = [EGUI_FROM_RGB, EGUI_UNMULTIPLIED, EGUI_GRAY];

const GPUI_RGB = formatId(undefined, 'rgb', 1);
const GPUI_RGBA = formatId(undefined, 'rgba', 1);
const GPUI_HSLA = formatId(undefined, 'hsla', 4);

const BEVY = 'Bevy 0.14+';

export const COLOR_FORMATS: readonly ColorFormat[] = [
	// ── egui / eframe: Color32 (u8, sRGB) ──────────────────────────────────
	call('egui', COLOR32, 'from_rgb', ints('r', 'g', 'b'), { alternatives: EGUI_CHOICES, withAlpha: EGUI_UNMULTIPLIED }),
	call('egui', COLOR32, 'from_rgba_unmultiplied', ints('r', 'g', 'b', 'a'), { alternatives: EGUI_CHOICES }),
	call('egui', COLOR32, 'from_rgba_unmultiplied_const', ints('r', 'g', 'b', 'a'), { alternatives: EGUI_CHOICES }),
	call('egui', COLOR32, 'from_rgba_premultiplied', ints('r', 'g', 'b', 'a'), { encoding: 'premultiplied', alternatives: EGUI_CHOICES }),
	call('egui', COLOR32, 'from_gray', ints('gray'), { alternatives: EGUI_CHOICES, withAlpha: EGUI_UNMULTIPLIED }),
	call('egui', COLOR32, 'from_black_alpha', ints('a'), { fixed: { r: 0, g: 0, b: 0 }, alternatives: EGUI_CHOICES }),
	call('egui', COLOR32, 'from_white_alpha', ints('a'), { fixed: { r: 255, g: 255, b: 255 }, alternatives: EGUI_CHOICES }),
	...EGUI_CONSTANTS.map(
		([name, r, g, b, a]): ColorFormat => ({
			id: `Color32::${name}`,
			libraries: 'egui',
			syntax: 'constant',
			owners: COLOR32,
			name,
			slots: [],
			value: [r, g, b, a],
			encoding: PREMULTIPLIED_CONSTANTS.has(name) ? 'premultiplied' : 'srgb',
			alternatives: EGUI_CHOICES,
		}),
	),

	// ── egui: Rgba (f32, linear light) ─────────────────────────────────────
	call('egui', EGUI_RGBA, 'from_rgb', floats('r', 'g', 'b'), { encoding: 'linear', withAlpha: formatId(EGUI_RGBA, 'from_rgba_unmultiplied', 4) }),
	call('egui', EGUI_RGBA, 'from_rgba_unmultiplied', floats('r', 'g', 'b', 'a'), { encoding: 'linear' }),
	call('egui', EGUI_RGBA, 'from_rgba_premultiplied', floats('r', 'g', 'b', 'a'), { encoding: 'linear-premultiplied' }),
	call('egui', EGUI_RGBA, 'from_gray', floats('gray'), { encoding: 'linear', withAlpha: formatId(EGUI_RGBA, 'from_rgba_unmultiplied', 4) }),
	call('egui', EGUI_RGBA, 'from_luminance_alpha', floats('gray', 'a'), { encoding: 'linear-premultiplied' }),
	call('egui', EGUI_RGBA, 'from_srgba_unmultiplied', ints('r', 'g', 'b', 'a')),
	call('egui', EGUI_RGBA, 'from_srgba_premultiplied', ints('r', 'g', 'b', 'a'), { encoding: 'premultiplied' }),

	// ── gpui (Zed) ─────────────────────────────────────────────────────────
	call('gpui', undefined, 'rgb', ints('rgb24'), { alternatives: [GPUI_RGB, GPUI_RGBA, GPUI_HSLA], withAlpha: GPUI_RGBA }),
	call('gpui', undefined, 'rgba', ints('rgba32'), { alternatives: [GPUI_RGBA, GPUI_RGB, GPUI_HSLA] }),
	call('gpui', undefined, 'hsla', floats('h', 's', 'l', 'a'), { hue: 'unit', alternatives: [GPUI_HSLA, GPUI_RGB, GPUI_RGBA] }),

	// ── Color::… shared by several libraries; the literal picks the scale ──
	call('iced, ggez, fltk', COLOR, 'from_rgb', auto('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'from_rgba', 4) }),
	call('iced, ggez, macroquad, tiny-skia', COLOR, 'from_rgba', auto('r', 'g', 'b', 'a')),
	call('iced, peniko (color)', COLOR, 'from_rgb8', ints('r', 'g', 'b')),
	// iced takes an f32 alpha, peniko and tiny-skia a u8 one.
	call('iced, peniko (color), tiny-skia', COLOR, 'from_rgba8', auto('r', 'g', 'b', 'a')),
	call('macroquad, ggez, raylib', COLOR, 'new', auto('r', 'g', 'b', 'a')),
	call('Bevy ≤0.13, druid, cosmic-text', COLOR, 'rgb', auto('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'rgba', 4) }),
	call('Bevy ≤0.13, druid, cosmic-text', COLOR, 'rgba', auto('r', 'g', 'b', 'a')),
	call('Bevy ≤0.13', COLOR, 'rgb_u8', ints('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'rgba_u8', 4) }),
	call('Bevy ≤0.13', COLOR, 'rgba_u8', ints('r', 'g', 'b', 'a')),
	call('Bevy ≤0.13', COLOR, 'rgb_linear', floats('r', 'g', 'b'), { encoding: 'linear', withAlpha: formatId(COLOR, 'rgba_linear', 4) }),
	call('Bevy ≤0.13', COLOR, 'rgba_linear', floats('r', 'g', 'b', 'a'), { encoding: 'linear' }),
	call('druid, peniko ≤0.2', COLOR, 'rgb8', ints('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'rgba8', 4) }),
	call('druid, peniko ≤0.2', COLOR, 'rgba8', ints('r', 'g', 'b', 'a')),
	call('druid', COLOR, 'grey8', ints('gray')),
	call('druid', COLOR, 'grey', floats('gray')),
	call('macroquad, fltk', COLOR, 'from_hex', ints('rgb24')),
	call('ratatui', COLOR, 'from_u32', ints('rgb24')),
	call('ratatui, termcolor', COLOR, 'Rgb', ints('r', 'g', 'b')),
	call('sdl2', COLOR, 'RGB', ints('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'RGBA', 4), alternatives: [formatId(COLOR, 'RGB', 3), formatId(COLOR, 'RGBA', 4)] }),
	call('sdl2', COLOR, 'RGBA', ints('r', 'g', 'b', 'a'), { alternatives: [formatId(COLOR, 'RGBA', 4), formatId(COLOR, 'RGB', 3)] }),
	{ ...call('peniko (color)', COLOR, 'new', floats('r', 'g', 'b', 'a')), id: 'Color.new([4])', syntax: 'array' },

	// ── Bevy 0.14+ (f32 unless _u8) ────────────────────────────────────────
	call(BEVY, COLOR, 'srgb', floats('r', 'g', 'b'), {
		withAlpha: formatId(COLOR, 'srgba', 4),
		alternatives: [formatId(COLOR, 'srgb', 3), formatId(COLOR, 'srgb_u8', 3), formatId(COLOR, 'hsl', 3)],
	}),
	call(BEVY, COLOR, 'srgba', floats('r', 'g', 'b', 'a'), {
		alternatives: [formatId(COLOR, 'srgba', 4), formatId(COLOR, 'srgba_u8', 4), formatId(COLOR, 'hsla', 4)],
	}),
	call(BEVY, COLOR, 'srgb_u8', ints('r', 'g', 'b'), {
		withAlpha: formatId(COLOR, 'srgba_u8', 4),
		alternatives: [formatId(COLOR, 'srgb_u8', 3), formatId(COLOR, 'srgb', 3), formatId(COLOR, 'hsl', 3)],
	}),
	call(BEVY, COLOR, 'srgba_u8', ints('r', 'g', 'b', 'a'), {
		alternatives: [formatId(COLOR, 'srgba_u8', 4), formatId(COLOR, 'srgba', 4), formatId(COLOR, 'hsla', 4)],
	}),
	call(BEVY, COLOR, 'linear_rgb', floats('r', 'g', 'b'), { encoding: 'linear', withAlpha: formatId(COLOR, 'linear_rgba', 4) }),
	call(BEVY, COLOR, 'linear_rgba', floats('r', 'g', 'b', 'a'), { encoding: 'linear' }),
	call('Bevy', COLOR, 'hsl', floats('h', 's', 'l'), {
		hue: 'degrees',
		withAlpha: formatId(COLOR, 'hsla', 4),
		alternatives: [formatId(COLOR, 'hsl', 3), formatId(COLOR, 'srgb', 3), formatId(COLOR, 'srgb_u8', 3)],
	}),
	call('Bevy', COLOR, 'hsla', floats('h', 's', 'l', 'a'), {
		hue: 'degrees',
		alternatives: [formatId(COLOR, 'hsla', 4), formatId(COLOR, 'srgba', 4), formatId(COLOR, 'srgba_u8', 4)],
	}),
	call(BEVY, ['Srgba'], 'rgb', floats('r', 'g', 'b'), { withAlpha: formatId(['Srgba'], 'new', 4) }),
	call(`${BEVY}, palette`, ['Srgba'], 'new', auto('r', 'g', 'b', 'a')),
	call(BEVY, ['Srgba'], 'rgb_u8', ints('r', 'g', 'b'), { withAlpha: formatId(['Srgba'], 'rgba_u8', 4) }),
	call(BEVY, ['Srgba'], 'rgba_u8', ints('r', 'g', 'b', 'a')),
	call(BEVY, ['LinearRgba'], 'rgb', floats('r', 'g', 'b'), { encoding: 'linear', withAlpha: formatId(['LinearRgba'], 'new', 4) }),
	call(BEVY, ['LinearRgba'], 'new', floats('r', 'g', 'b', 'a'), { encoding: 'linear' }),
	call(`${BEVY}, palette`, ['Hsla'], 'new', floats('h', 's', 'l', 'a'), { hue: 'degrees' }),
	call(BEVY, ['Hsla'], 'hsl', floats('h', 's', 'l'), { hue: 'degrees', withAlpha: formatId(['Hsla'], 'new', 4) }),

	// ── palette ────────────────────────────────────────────────────────────
	call('palette', ['Srgb'], 'new', auto('r', 'g', 'b'), { withAlpha: formatId(['Srgba'], 'new', 4) }),
	call('palette', ['LinSrgb'], 'new', floats('r', 'g', 'b'), { encoding: 'linear', withAlpha: formatId(['LinSrgba'], 'new', 4) }),
	call('palette', ['LinSrgba'], 'new', floats('r', 'g', 'b', 'a'), { encoding: 'linear' }),
	call('palette', ['Hsl'], 'new', floats('h', 's', 'l'), { hue: 'degrees', withAlpha: formatId(['Hsla'], 'new', 4) }),

	// ── Slint (argb order) ─────────────────────────────────────────────────
	call('Slint', COLOR, 'from_rgb_u8', ints('r', 'g', 'b'), {
		withAlpha: formatId(COLOR, 'from_argb_u8', 4),
		alternatives: [formatId(COLOR, 'from_rgb_u8', 3), formatId(COLOR, 'from_argb_encoded', 1)],
	}),
	call('Slint', COLOR, 'from_argb_u8', ints('a', 'r', 'g', 'b'), {
		alternatives: [formatId(COLOR, 'from_argb_u8', 4), formatId(COLOR, 'from_argb_encoded', 1)],
	}),
	call('Slint', COLOR, 'from_rgb_f32', floats('r', 'g', 'b'), { withAlpha: formatId(COLOR, 'from_argb_f32', 4) }),
	call('Slint', COLOR, 'from_argb_f32', floats('a', 'r', 'g', 'b')),
	call('Slint', COLOR, 'from_argb_encoded', ints('argb32'), {
		alternatives: [formatId(COLOR, 'from_argb_encoded', 1), formatId(COLOR, 'from_rgb_u8', 3), formatId(COLOR, 'from_argb_u8', 4)],
	}),

	// ── tiny-skia, colored ─────────────────────────────────────────────────
	call('tiny-skia', ['ColorU8'], 'from_rgba', ints('r', 'g', 'b', 'a')),
	call('colored', ['CustomColor'], 'new', ints('r', 'g', 'b')),

	// ── Free functions and tuple structs ───────────────────────────────────
	call('plotters', undefined, 'RGBColor', ints('r', 'g', 'b'), {
		withAlpha: formatId(undefined, 'RGBAColor', 4),
		alternatives: [formatId(undefined, 'RGBColor', 3), formatId(undefined, 'RGBAColor', 4)],
	}),
	call('plotters', undefined, 'RGBAColor', [...ints('r', 'g', 'b'), ...floats('a')], {
		alternatives: [formatId(undefined, 'RGBAColor', 4), formatId(undefined, 'RGBColor', 3)],
	}),
	call('owo-colors', undefined, 'Rgb', ints('r', 'g', 'b')),
	{ ...call('image', undefined, 'Rgb', auto('r', 'g', 'b')), id: 'Rgb([3])', syntax: 'array', withAlpha: 'Rgba([4])' },
	{ ...call('image', undefined, 'Rgba', auto('r', 'g', 'b', 'a')), id: 'Rgba([4])', syntax: 'array' },

	// ── Methods: "text".truecolor(r, g, b) ─────────────────────────────────
	{ ...call('colored, owo-colors', undefined, 'truecolor', ints('r', 'g', 'b')), id: '.truecolor/3', syntax: 'method' },
	{ ...call('colored, owo-colors', undefined, 'on_truecolor', ints('r', 'g', 'b')), id: '.on_truecolor/3', syntax: 'method' },

	// ── Struct variants: Color::Rgb { r, g, b } ────────────────────────────
	{ ...call('crossterm', COLOR, 'Rgb', ints('r', 'g', 'b')), id: 'Color::Rgb{}', syntax: 'struct' },
	{ ...call('colored', COLOR, 'TrueColor', ints('r', 'g', 'b')), id: 'Color::TrueColor{}', syntax: 'struct' },

	// ── Macros ─────────────────────────────────────────────────────────────
	{ ...call('iced', undefined, 'color', ints('rgb24')), id: 'color!(hex)', syntax: 'macro', withAlpha: 'color!(hex, a)' },
	{ ...call('iced', undefined, 'color', [...ints('rgb24'), ...floats('a')]), id: 'color!(hex, a)', syntax: 'macro' },
	{
		...call('iced', undefined, 'color', [
			{ channel: 'r', number: 'int', scale: 'byte' },
			{ channel: 'g', number: 'int', scale: 'byte' },
			{ channel: 'b', number: 'int', scale: 'byte' },
		]),
		id: 'color!(r, g, b)',
		syntax: 'macro',
		withAlpha: 'color!(r, g, b, a)',
	},
	{
		...call('iced', undefined, 'color', [
			{ channel: 'r', number: 'int', scale: 'byte' },
			{ channel: 'g', number: 'int', scale: 'byte' },
			{ channel: 'b', number: 'int', scale: 'byte' },
			{ channel: 'a', number: 'float' },
		]),
		id: 'color!(r, g, b, a)',
		syntax: 'macro',
	},
	{
		...call('macroquad', undefined, 'color_u8', ['r', 'g', 'b', 'a'].map((channel): Slot => ({ channel: channel as Channel, number: 'int', scale: 'byte' }))),
		id: 'color_u8!',
		syntax: 'macro',
	},
];

const BY_ID = new Map(COLOR_FORMATS.map((format) => [format.id, format]));
const BY_NAME = new Map<string, ColorFormat[]>();
for (const format of COLOR_FORMATS) {
	BY_NAME.set(format.name, [...(BY_NAME.get(format.name) ?? []), format]);
}

export function formatById(id: string): ColorFormat | undefined {
	return BY_ID.get(id);
}

/** Formats that could start at an identifier with this name. */
export function formatsNamed(name: string): readonly ColorFormat[] {
	return BY_NAME.get(name) ?? [];
}

/** egui's constant with exactly this colour, for offering `Color32::RED` back. */
export function eguiConstantFor(bytes: readonly [number, number, number, number]): ColorFormat | undefined {
	return COLOR_FORMATS.find(
		(format) =>
			format.syntax === 'constant' &&
			format.encoding !== 'premultiplied' &&
			format.value !== undefined &&
			format.value.every((channel, index) => channel === bytes[index]),
	);
}
