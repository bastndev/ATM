import { loadSmolToml, toSyntaxError, TomlSyntaxError } from './smolToml';

export type ConversionResult =
	| { ok: true; text: string }
	| { ok: false; reason: 'invalidToml'; error: TomlSyntaxError }
	| { ok: false; reason: 'invalidJson' | 'notAnObject' | 'unsupported'; message: string };

const BIGINT_MARK = '@@atm-toml-bigint@@';

/**
 * Converts TOML text to JSON. Dates become ISO strings, `inf` and `nan`
 * become `null`, and integers too large for a JS number keep all their digits.
 */
export async function tomlToJson(toml: string, indent: string | number = 2): Promise<ConversionResult> {
	const { parse } = await loadSmolToml();
	let data: unknown;
	try {
		data = parse(toml, { integersAsBigInt: 'asNeeded' });
	} catch (error) {
		return { ok: false, reason: 'invalidToml', error: toSyntaxError(error) };
	}
	const json = JSON.stringify(
		data,
		(_key, value: unknown) => (typeof value === 'bigint' ? `${BIGINT_MARK}${value.toString()}` : value),
		indent,
	);
	return { ok: true, text: json.replace(new RegExp(`"${BIGINT_MARK}(-?\\d+)"`, 'g'), '$1') };
}

/**
 * Converts JSON text to TOML. The top level must be an object, because a
 * TOML document is a table. `null` values are dropped (TOML has no null),
 * and `null` inside an array is an error.
 */
export async function jsonToToml(json: string): Promise<ConversionResult> {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch (error) {
		return { ok: false, reason: 'invalidJson', message: (error as Error).message };
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return { ok: false, reason: 'notAnObject', message: 'TOML needs a JSON object at the top level' };
	}
	const { stringify } = await loadSmolToml();
	try {
		return { ok: true, text: stringify(data).trim() };
	} catch (error) {
		return { ok: false, reason: 'unsupported', message: (error as Error).message };
	}
}
