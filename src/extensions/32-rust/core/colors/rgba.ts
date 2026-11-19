/**
 * The colour model shared by every Rust colour format: what VS Code's
 * picker works with, and the conversions libraries need (linear light,
 * premultiplied alpha, HSL).
 */

/** sRGB channels and alpha, each from 0 to 1, alpha not premultiplied. */
export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * 0–1 to 0–255, the way every library rounds (half up). The tiny nudge
 * keeps float noise from turning an exact 127.5 into 127.4999… → 127.
 */
export function toByte(value: number): number {
	return Math.round(clamp01(value) * 255 + 1e-7);
}

/** The standard sRGB curve, as egui, Bevy and palette use it. */
export function linearToSrgb(value: number): number {
	return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

export function srgbToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Hue, saturation and lightness from 0 to 1 → sRGB channels. */
export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
	if (saturation === 0) {
		return [lightness, lightness, lightness];
	}
	const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const channel = (t: number) => {
		const x = wrap01(t);
		if (x < 1 / 6) {
			return p + (q - p) * 6 * x;
		}
		if (x < 1 / 2) {
			return q;
		}
		if (x < 2 / 3) {
			return p + (q - p) * (2 / 3 - x) * 6;
		}
		return p;
	};
	const h = wrap01(hue);
	return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** sRGB channels → hue, saturation and lightness, each from 0 to 1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	if (max === min) {
		return [0, 0, lightness];
	}
	const delta = max - min;
	const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	let hue: number;
	if (max === r) {
		hue = (g - b) / delta + (g < b ? 6 : 0);
	} else if (max === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}
	return [hue / 6, saturation, lightness];
}

function wrap01(value: number): number {
	return ((value % 1) + 1) % 1;
}
