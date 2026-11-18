import { loadSmolToml, toSyntaxError, TomlSyntaxError } from './smolToml';

/**
 * Checks a TOML document against the TOML 1.1 spec. Returns the first error,
 * or `undefined` when the document is valid. smol-toml stops at the first
 * error, so at most one problem is reported at a time.
 */
export async function validateToml(text: string): Promise<TomlSyntaxError | undefined> {
	const { parse, TomlError } = await loadSmolToml();
	try {
		// 'asNeeded' accepts 64-bit integers that a JS number can't hold exactly;
		// the default would report them as errors although they are valid TOML.
		parse(text, { integersAsBigInt: 'asNeeded' });
		return undefined;
	} catch (error) {
		return error instanceof TomlError ? toSyntaxError(error) : undefined;
	}
}
