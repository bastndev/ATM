import * as assert from 'assert';
import { colorPresentations, findColors, Rgba } from '../extensions/32-rust/core/colors';
import { formatNumber, parseNumber } from '../extensions/32-rust/core/colors/literals';
import { hslToRgb, linearToSrgb, rgbToHsl, srgbToLinear, toByte } from '../extensions/32-rust/core/colors/rgba';
import { tokenizeRust } from '../extensions/32-rust/core/lexer';

// No VS Code API here: this file also runs under plain mocha (--ui tdd).

/** `#rrggbb`, plus `aa` when not opaque. */
function hex(color: Rgba): string {
	const byte = (value: number) => toByte(value).toString(16).padStart(2, '0');
	return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}${color.a < 1 ? byte(color.a) : ''}`;
}

function rgba(text: string): Rgba {
	const byte = (index: number) => parseInt(text.slice(1 + index * 2, 3 + index * 2), 16) / 255;
	return { r: byte(0), g: byte(1), b: byte(2), a: text.length === 9 ? byte(3) : 1 };
}

/** `swatch text → colour` for every colour in the source. */
function colorsIn(source: string): string[] {
	return findColors(tokenizeRust(source)).map((match) => `${source.slice(match.start, match.end)} → ${hex(match.color)}`);
}

/** What the picker writes for `snippet` (the first colour whose text it is) when `picked` is chosen. */
function pick(source: string, snippet: string, picked: string): { texts: string[]; labels: string[] } {
	const tokens = tokenizeRust(source);
	const match = findColors(tokens).find((found) => source.slice(found.start, found.end) === snippet);
	assert.ok(match, `no colour at ${snippet}`);
	const choices = colorPresentations(tokens, match.start, match.end, source.slice(match.start, match.end), rgba(picked));
	return { texts: choices.map((choice) => choice.text), labels: choices.map((choice) => choice.label) };
}

suite('Rust Colors Test Suite', () => {
	suite('egui', () => {
		test('shows the user\'s Color32::from_rgb, path included', () => {
			assert.deepStrictEqual(colorsIn('let blue_bg = egui::Color32::from_rgb(10, 130, 20);'), ['egui::Color32::from_rgb(10, 130, 20) → #0a8214']);
		});

		test('the picker keeps the format, the path, the suffixes and the hex digits', () => {
			const picked = pick('let c = egui::Color32::from_rgb(10, 130, 20);', 'egui::Color32::from_rgb(10, 130, 20)', '#aef958');
			assert.strictEqual(picked.texts[0], 'egui::Color32::from_rgb(174, 249, 88)');
			assert.strictEqual(picked.labels[0], 'Color32::from_rgb(174, 249, 88)');
			assert.ok(picked.texts.includes('egui::Color32::from_rgba_unmultiplied(174, 249, 88, 255)'));

			const styled = 'Color32::from_rgb(0x8B, 10u8, 0)';
			assert.strictEqual(pick(styled, styled, '#aef958').texts[0], 'Color32::from_rgb(0xAE, 249u8, 88)');
		});

		test('keeps line breaks and comments inside a multi-line call', () => {
			const source = 'Color32::from_rgb(\n    10, // red\n    130,\n    20,\n)';
			assert.strictEqual(pick(source, source, '#aef958').texts[0], 'Color32::from_rgb(\n    174, // red\n    249,\n    88,\n)');
		});

		test('transparency switches to from_rgba_unmultiplied; grey and constants are offered when they fit', () => {
			const source = 'Color32::from_rgb(10, 130, 20)';
			assert.strictEqual(pick(source, source, '#aef95880').texts[0], 'Color32::from_rgba_unmultiplied(174, 249, 88, 128)');
			assert.deepStrictEqual(pick(source, source, '#808080').texts, ['Color32::from_rgb(128, 128, 128)', 'Color32::from_rgba_unmultiplied(128, 128, 128, 255)', 'Color32::from_gray(128)']);
			assert.ok(pick(source, source, '#ff0000').texts.includes('Color32::RED'));

			const gray = 'Color32::from_gray(128)';
			assert.deepStrictEqual(colorsIn(gray), ['Color32::from_gray(128) → #808080']);
			assert.strictEqual(pick(gray, gray, '#c8c8c8').texts[0], 'Color32::from_gray(200)');
			assert.strictEqual(pick(gray, gray, '#aef958').texts[0], 'Color32::from_rgb(174, 249, 88)');
		});

		test('named colours, premultiplied alpha and black/white alpha', () => {
			assert.deepStrictEqual(colorsIn('[Color32::RED, egui::Color32::DARK_RED, Color32::TRANSPARENT]'), [
				'Color32::RED → #ff0000',
				'egui::Color32::DARK_RED → #8b0000',
				'Color32::TRANSPARENT → #00000000',
			]);
			const constant = 'egui::Color32::RED';
			assert.strictEqual(pick(constant, constant, '#aef958').texts[0], 'egui::Color32::from_rgb(174, 249, 88)');
			assert.strictEqual(pick(constant, constant, '#ff0000').texts[0], 'egui::Color32::RED');

			assert.deepStrictEqual(colorsIn('Color32::from_rgba_premultiplied(64, 0, 0, 128)'), ['Color32::from_rgba_premultiplied(64, 0, 0, 128) → #80000080']);
			const premultiplied = 'Color32::from_rgba_premultiplied(64, 0, 0, 128)';
			assert.strictEqual(pick(premultiplied, premultiplied, '#ff000080').texts[0], 'Color32::from_rgba_premultiplied(128, 0, 0, 128)');
			assert.deepStrictEqual(colorsIn('Color32::from_black_alpha(128)'), ['Color32::from_black_alpha(128) → #00000080']);
		});

		test('egui Rgba is linear light', () => {
			assert.deepStrictEqual(colorsIn('Rgba::from_rgb(0.5, 0.5, 0.5)'), ['Rgba::from_rgb(0.5, 0.5, 0.5) → #bcbcbc']);
			const source = 'Rgba::from_rgb(0.5, 0.5, 0.5)';
			assert.strictEqual(pick(source, source, '#bcbcbc').texts[0], 'Rgba::from_rgb(0.503, 0.503, 0.503)');
		});
	});

	suite('things that are not colours', () => {
		test('comments, variables, out-of-range values, definitions and other types', () => {
			const source = [
				'// Color32::from_rgb(1, 2, 3)',
				'/* rgb(0xffffff) */',
				'Color32::from_rgb(r, g, b);',
				'Color32::from_rgb(300, 0, 0);',
				'Color::srgb(5.0, 2.0, 0.0);',
				'fn rgb(hex: u32) -> Rgba { todo!() }',
				'Vec::new(1, 2, 3, 4);',
				'Foo::from_rgb(1, 2, 3);',
				'rgb(16777215);',
				'match c { Color::Rgb { r, g, b } => {} }',
				'let x = "Fix #123 and #abc";',
				'let y = b"#ffffff";',
			].join('\n');
			assert.deepStrictEqual(colorsIn(source), []);
		});
	});

	suite('gpui (Zed)', () => {
		test('rgb, rgba and hsla with the hue written as degrees / 360', () => {
			assert.deepStrictEqual(colorsIn('div().bg(rgb(0x1e1e1e)).border_color(gpui::rgba(0xffffff80)).text_color(hsla(210.0 / 360.0, 0.5, 0.5, 1.0))'), [
				'rgb(0x1e1e1e) → #1e1e1e',
				'gpui::rgba(0xffffff80) → #ffffff80',
				'hsla(210.0 / 360.0, 0.5, 0.5, 1.0) → #4080bf',
			]);
			const hsla = 'hsla(210.0 / 360.0, 0.5, 0.5, 1.0)';
			assert.strictEqual(pick(hsla, hsla, '#ff0000').texts[0], 'hsla(0.0 / 360.0, 1.0, 0.5, 1.0)');
			assert.strictEqual(pick(hsla, hsla, '#00ff00').texts[0], 'hsla(120.0 / 360.0, 1.0, 0.5, 1.0)');
			const rgb = 'rgb(0x1E1E1E)';
			assert.deepStrictEqual(pick(rgb, rgb, '#aef95880').texts, ['rgba(0xAEF95880)', 'hsla(0.244, 0.931, 0.661, 0.502)']);
		});
	});

	suite('iced, ggez, fltk, tiny-skia: one name, the literal decides', () => {
		test('floats are 0–1 and integers 0–255, and stay so when alpha is added', () => {
			assert.deepStrictEqual(colorsIn('Color::from_rgb(0.5, 0.25, 1.0); Color::from_rgb(255, 128, 0);'), [
				'Color::from_rgb(0.5, 0.25, 1.0) → #8040ff',
				'Color::from_rgb(255, 128, 0) → #ff8000',
			]);
			const floats = 'Color::from_rgb(0.5, 0.25, 1.0)';
			assert.strictEqual(pick(floats, floats, '#aef958').texts[0], 'Color::from_rgb(0.682, 0.976, 0.345)');
			assert.strictEqual(pick(floats, floats, '#aef95880').texts[0], 'Color::from_rgba(0.682, 0.976, 0.345, 0.502)');
			const ints = 'Color::from_rgb(255, 128, 0)';
			assert.strictEqual(pick(ints, ints, '#aef95880').texts[0], 'Color::from_rgba(174, 249, 88, 128)');
			assert.deepStrictEqual(colorsIn('Color::from_rgba8(255, 0, 0, 0.5); Color::from_rgba8(255, 0, 0, 128);'), [
				'Color::from_rgba8(255, 0, 0, 0.5) → #ff000080',
				'Color::from_rgba8(255, 0, 0, 128) → #ff000080',
			]);
		});

		test('iced\'s color! macro', () => {
			assert.deepStrictEqual(colorsIn('color!(0xff0000); iced::color!(0xff0000, 0.5); color!(255, 0, 0);'), [
				'color!(0xff0000) → #ff0000',
				'iced::color!(0xff0000, 0.5) → #ff000080',
				'color!(255, 0, 0) → #ff0000',
			]);
			const macro = 'color!(0xff0000)';
			assert.strictEqual(pick(macro, macro, '#aef95880').texts[0], 'color!(0xaef958, 0.502)');
		});
	});

	suite('Bevy', () => {
		test('srgb, srgb_u8, hsl in degrees and linear_rgb', () => {
			assert.deepStrictEqual(colorsIn('Color::srgb(1.0, 0.5, 0.0); Color::srgb_u8(255, 128, 0); Color::hsl(210.0, 0.5, 0.5); Color::linear_rgb(0.5, 0.5, 0.5);'), [
				'Color::srgb(1.0, 0.5, 0.0) → #ff8000',
				'Color::srgb_u8(255, 128, 0) → #ff8000',
				'Color::hsl(210.0, 0.5, 0.5) → #4080bf',
				'Color::linear_rgb(0.5, 0.5, 0.5) → #bcbcbc',
			]);
			const srgb = 'Color::srgb(1.0, 0.5, 0.0)';
			assert.deepStrictEqual(pick(srgb, srgb, '#aef958').texts, ['Color::srgb(0.682, 0.976, 0.345)', 'Color::srgb_u8(174, 249, 88)', 'Color::hsl(88.0, 0.931, 0.661)']);
			assert.strictEqual(pick(srgb, srgb, '#aef95880').texts[0], 'Color::srgba(0.682, 0.976, 0.345, 0.502)');
		});
	});

	suite('Slint, ratatui, crossterm, sdl2, plotters, image, peniko, colored', () => {
		test('argb order, tuple and struct variants, arrays and methods', () => {
			assert.deepStrictEqual(
				colorsIn(
					[
						'Color::from_argb_u8(128, 255, 0, 0);',
						'Color::from_argb_encoded(0x80ff0000);',
						'Color::Rgb(255, 0, 0);',
						'Color::Rgb { r: 0, g: 0, b: 255 };',
						'Color::RGB(0, 255, 0);',
						'RGBAColor(255, 0, 0, 0.5);',
						'image::Rgba([255, 0, 0, 128]);',
						'Color::new([1.0, 0.0, 0.0, 1.0]);',
						'"hi".truecolor(0, 255, 136);',
					].join('\n'),
				),
				[
					'Color::from_argb_u8(128, 255, 0, 0) → #ff000080',
					'Color::from_argb_encoded(0x80ff0000) → #ff000080',
					'Color::Rgb(255, 0, 0) → #ff0000',
					'Color::Rgb { r: 0, g: 0, b: 255 } → #0000ff',
					'Color::RGB(0, 255, 0) → #00ff00',
					'RGBAColor(255, 0, 0, 0.5) → #ff000080',
					'image::Rgba([255, 0, 0, 128]) → #ff000080',
					'Color::new([1.0, 0.0, 0.0, 1.0]) → #ff0000',
					'truecolor(0, 255, 136) → #00ff88',
				],
			);
			const argb = 'Color::from_argb_u8(128, 255, 0, 0)';
			assert.strictEqual(pick(argb, argb, '#aef958').texts[0], 'Color::from_argb_u8(255, 174, 249, 88)');
			const struct = 'Color::Rgb { b: 255, r: 0, g: 0 }';
			assert.strictEqual(pick(struct, struct, '#aef958').texts[0], 'Color::Rgb { b: 88, r: 174, g: 249 }');
			const sdl = 'Color::RGB(0, 255, 0)';
			assert.strictEqual(pick(sdl, sdl, '#aef95880').texts[0], 'Color::RGBA(174, 249, 88, 128)');
			const array = 'Rgb([255, 0, 0])';
			assert.strictEqual(pick(array, array, '#aef95880').texts[0], 'Rgba([174, 249, 88, 128])');
			const method = '"hi".truecolor(0, 255, 136)';
			assert.deepStrictEqual(pick(method, 'truecolor(0, 255, 136)', '#aef958'), { texts: ['truecolor(174, 249, 88)'], labels: ['.truecolor(174, 249, 88)'] });
		});
	});

	suite('colours in strings', () => {
		test('a whole-string hex colour, with # optional in hex functions', () => {
			assert.deepStrictEqual(colorsIn('Color32::from_hex("#aef958"); Srgba::hex("aef958"); hex_color!("#FFF"); let c = "#00ff0080"; let raw = r#"#123"#;'), [
				'#aef958 → #aef958',
				'aef958 → #aef958',
				'#FFF → #ffffff',
				'#00ff0080 → #00ff0080',
				'#123 → #112233',
			]);
			const source = 'Srgba::hex("aef958"); hex_color!("#FFF");';
			assert.deepStrictEqual(pick(source, 'aef958', '#102030').texts, ['102030']);
			assert.deepStrictEqual(pick(source, '#FFF', '#aef958').texts, ['#AEF958']);
			assert.deepStrictEqual(pick(source, '#FFF', '#000000').texts, ['#000', '#000000']);
			assert.deepStrictEqual(pick('"#aef958"', '#aef958', '#aef95880').texts, ['#aef95880']);
		});

		test('CSS in Dioxus and Leptos style strings', () => {
			const source = 'div { style: "color: #fff; border: 1px solid rgb(0, 0, 0); background: hsl(210, 50%, 50%)" }';
			assert.deepStrictEqual(colorsIn(source), ['#fff → #ffffff', 'rgb(0, 0, 0) → #000000', 'hsl(210, 50%, 50%) → #4080bf']);
			assert.deepStrictEqual(pick(source, 'rgb(0, 0, 0)', '#aef95880').texts, ['rgba(174, 249, 88, 0.5)', '#aef95880', 'hsla(88, 93%, 66%, 0.5)']);
			assert.deepStrictEqual(colorsIn('let s = "rgb(255 0 0 / 50%)";'), ['rgb(255 0 0 / 50%) → #ff000080']);
		});
	});

	suite('picker speed: reading only the colour\'s lines', () => {
		test('one line answers like the whole file, and answers nothing when the colour sits in an earlier-opened string', () => {
			const source = 'fn theme() {\n    let a = Color32::from_rgb(10, 130, 20);\n    let css = "\n        color: #fff;\n    ";\n}';
			const tokens = tokenizeRust(source);
			const lineOf = (offset: number) => {
				const start = source.lastIndexOf('\n', offset - 1) + 1;
				const end = source.indexOf('\n', offset);
				return { start, text: source.slice(start, end < 0 ? source.length : end) };
			};
			const picked = rgba('#aef958');
			const [call, hexColor] = findColors(tokens);
			assert.strictEqual(source.slice(hexColor.start, hexColor.end), '#fff');

			const callLine = lineOf(call.start);
			const original = source.slice(call.start, call.end);
			assert.deepStrictEqual(
				colorPresentations(tokenizeRust(callLine.text), call.start - callLine.start, call.end - callLine.start, original, picked),
				colorPresentations(tokens, call.start, call.end, original, picked),
			);

			// Alone, this line reads as code, so the provider falls back to the whole file.
			const hexLine = lineOf(hexColor.start);
			assert.deepStrictEqual(colorPresentations(tokenizeRust(hexLine.text), hexColor.start - hexLine.start, hexColor.end - hexLine.start, '#fff', picked), []);
			assert.deepStrictEqual(colorPresentations(tokens, hexColor.start, hexColor.end, '#fff', picked)[0].text, '#aef958');
		});
	});

	suite('numbers and colour maths', () => {
		test('Rust literals keep their look', () => {
			const rewrite = (text: string, value: number, precision = 3) => {
				const literal = parseNumber(text);
				assert.ok(literal, text);
				return formatNumber(value, literal.style, precision);
			};
			assert.strictEqual(parseNumber('0xAE_F9_58')?.value, 0xaef958);
			assert.strictEqual(rewrite('0xAE_F9_58', 0x102030, 0), '0x10_20_30');
			assert.strictEqual(rewrite('0x8B', 10, 0), '0x0A');
			assert.strictEqual(rewrite('10u8', 200, 0), '200u8');
			assert.strictEqual(rewrite('255_u8', 7, 0), '7_u8');
			assert.strictEqual(rewrite('1.0', 0.68235), '0.682');
			assert.strictEqual(rewrite('0.50f32', 0.25), '0.25f32');
			assert.strictEqual(rewrite('1.0', 1), '1.0');
			assert.strictEqual(rewrite('1.', 0), '0.');
			assert.strictEqual(rewrite('1e-1', 0.5), '0.5');
			assert.strictEqual(parseNumber('0b1010'), undefined);
		});

		test('HSL and linear conversions go back and forth', () => {
			const [r, g, b] = hslToRgb(210 / 360, 0.5, 0.5);
			const [h, s, l] = rgbToHsl(r, g, b);
			assert.ok(Math.abs(h - 210 / 360) < 1e-9 && Math.abs(s - 0.5) < 1e-9 && Math.abs(l - 0.5) < 1e-9);
			for (const value of [0, 0.002, 0.2, 0.5, 1]) {
				assert.ok(Math.abs(linearToSrgb(srgbToLinear(value)) - value) < 1e-9);
			}
		});
	});
});
