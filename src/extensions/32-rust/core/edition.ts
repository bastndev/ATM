/**
 * rustfmt needs the crate's edition (2015 is assumed otherwise, which
 * rejects `async fn` and other newer syntax). It lives in Cargo.toml, either
 * directly or inherited from the workspace root.
 */

export type EditionLookup = { edition: string } | { inherited: true } | undefined;

const DIRECT = /^\s*edition\s*=\s*["'](\d{4})["']/m;
const INHERITED = /^\s*edition\s*(?:\.\s*workspace\s*=\s*true|=\s*\{\s*workspace\s*=\s*true\s*\})/m;

/** Reads `edition` from one Cargo.toml (`[package]` or `[workspace.package]`). */
export function readEdition(cargoToml: string): EditionLookup {
	const direct = DIRECT.exec(cargoToml);
	if (direct) {
		return { edition: direct[1] };
	}
	return INHERITED.test(cargoToml) ? { inherited: true } : undefined;
}

/** Edition used when no Cargo.toml says otherwise. */
export const DEFAULT_EDITION = '2021';
