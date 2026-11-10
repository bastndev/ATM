import * as path from 'path';

// ── Exclusion filter for code-spell ──────────────────────────────────────────
// Folders, files, and extensions where spell-checking is wasteful or noisy.

// ── Languages where spell-checking IS useful (white list) ─────────────────────
export const SUPPORTED_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'javascriptreact',
  'typescriptreact',
  'html',
  'plaintext',
  'markdown',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
]);

// ── Folders to completely ignore ─────────────────────────────────────────────
const IGNORED_FOLDERS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.angular',
  '.vite',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.expo',
  'coverage',
  '__pycache__',
  '.dart_tool',
  '.flutter-plugins',
  '.pub-cache',
  '.gradle',
  '.idea',
  'vendor',
  'temp',
  'tmp',
]);

// ── Exact filenames to ignore ────────────────────────────────────────────────
const IGNORED_FILENAMES = new Set([
  'notes.md',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'go.sum',
  'pubspec.lock',
  '.ds_store',
  'thumbs.db',
]);

// ── File extensions to ignore ────────────────────────────────────────────────
const IGNORED_EXTENSIONS = new Set([
  '.map',
  '.svg',
  '.lock',
  '.log',
  '.env',
  '.snap',
  '.patch',
]);

/**
 * Returns `true` if the file should be **excluded** from spell-checking.
 * Checks: folder segments → exact filename → .min.* → .d.ts → extension.
 */
export function shouldIgnoreFile(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, '/');
  const segments = normalized.split('/');

  // Folder match
  for (const seg of segments) {
    if (IGNORED_FOLDERS.has(seg)) {
      return true;
    }
  }

  const basename = path.basename(normalized).toLowerCase();

  // Exact filename match
  if (IGNORED_FILENAMES.has(basename)) {
    return true;
  }

  // Minified files (.min.js, .min.css)
  if (basename.endsWith('.min.js') || basename.endsWith('.min.css')) {
    return true;
  }

  // TypeScript declaration files (.d.ts)
  if (basename.endsWith('.d.ts')) {
    return true;
  }

  // Extension match
  const ext = path.extname(basename);
  if (ext && IGNORED_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}
