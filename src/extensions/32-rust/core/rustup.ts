/**
 * rustup downloads a whole Rust toolchain (often hundreds of MB) when a
 * project's rust-toolchain.toml asks for one that isn't installed. Every
 * Rust tool ATM starts gets this variable, so ATM never causes a download:
 * the tool stops at once, and rustup's message says how to install the
 * toolchain if the user wants it.
 */
export const NO_AUTO_INSTALL: Readonly<Record<string, string>> = { RUSTUP_AUTO_INSTALL: '0' };
