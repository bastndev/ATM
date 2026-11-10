const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// Runtime deps externalized in the extension bundle (see `external` below).
// vsce ("vsce": { "dependencies": false } in package.json) NEVER packs root
// node_modules — .vscodeignore negations are ignored for it — so copy the full
// dependency closure into dist/node_modules: Node resolves it first from
// dist/extension.js. Keep in sync with `external` + package deps.
const RUNTIME_DEPS = ['prettier', '@astrojs/compiler', 'sass-formatter', 'suf-log', 's.color'];

function copyRuntimeDeps() {
	for (const dep of RUNTIME_DEPS) {
		const src = path.join(__dirname, 'node_modules', dep);
		const dest = path.join(__dirname, 'dist', 'node_modules', dep);
		fs.rmSync(dest, { recursive: true, force: true });
		// dereference: bun/pnpm may symlink packages
		fs.cpSync(src, dest, { recursive: true, dereference: true });
	}
}

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const extensionEsbuildProblemMatcherPlugin = {
	name: 'extension-esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

const browserEsbuildProblemMatcherPlugin = {
	name: 'browser-esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[browser-watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[browser-watch] build finished');
		});
	},
};

async function main() {
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// node-fetch 2 still imports Node's deprecated built-in `punycode` module.
		// Bundle the maintained userland package instead to keep activation clean.
		alias: {
			punycode: 'punycode/',
		},
		// bufferutil / utf-8-validate are optional native accelerators probed by
		// `ws` inside try/catch — leave them unresolved instead of bundling.
		// @astrojs/compiler loads a ~5 MB WASM file at runtime via import.meta.url;
		// externalizing keeps the WASM lazy-loaded from node_modules only when
		// an .astro file is formatted.
		external: [
			'vscode',
			'prettier',
			'NeteaseCloudMusicApi',
			'bufferutil',
			'utf-8-validate',
			'@astrojs/compiler',
			'@astrojs/compiler/sync',
			'@astrojs/compiler/utils',
			'sass-formatter',
		],
		logLevel: 'silent',
		plugins: [extensionEsbuildProblemMatcherPlugin],
	});

	const browserCtx = await esbuild.context({
		entryPoints: [
			'src/extensions/12-markdown-md/ui/mermaidPreview.ts',
			'src/extensions/13-markdown-mdx/ui/mdxPreviewWebview.ts',
			'src/extensions/10-git-better/gitlab-panel/panels/header/header.ts',
			'src/extensions/10-git-better/gitlab-panel/panels/graphics-top/graphics.ts',
			'src/extensions/10-git-better/gitlab-panel/panels/stats-left/stats.ts',
			'src/extensions/10-git-better/gitlab-panel/panels/commits-center/commits.ts',
			'src/extensions/10-git-better/gitlab-panel/panels/inspect-right/inspect.ts',
			'src/extensions/14-screenshot-code/ui/webview.ts',
			'src/extensions/14-screenshot-code/ui/styles.css',
			'src/extensions/21-23-25/pages/translate/ui/atm-translate.ts',
			'src/extensions/21-23-25/pages/compare-code/ui/compare-code.ts',
			'src/extensions/09-focus/screens/atm-data/screenshot/ui/index.ts',
			'src/extensions/21-23-25/pages/browser/ui/browser.ts',
			'src/extensions/21-23-25/ui/ira.ts',
			'src/extensions/21-23-25/pages/git-commands/ui/git-commands.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		target: ['es2020'],
		outdir: 'dist',
		entryNames: '[name]',
		logLevel: 'silent',
		plugins: [browserEsbuildProblemMatcherPlugin],
	});

	const focusWebviewCtx = await esbuild.context({
		entryPoints: ['src/extensions/09-focus/view/ui/index.ts'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/atm-music-webview.js',
		logLevel: 'silent',
		plugins: [browserEsbuildProblemMatcherPlugin],
	});

	const serverCtx = await esbuild.context({
		entryPoints: [
			'src/extensions/02-atm-lint/server/lintServer.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/lintServer.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [extensionEsbuildProblemMatcherPlugin],
	});

	if (watch) {
		await extensionCtx.watch();
		await browserCtx.watch();
		await focusWebviewCtx.watch();
		await serverCtx.watch();
	} else {
		copyRuntimeDeps();
		await extensionCtx.rebuild();
		await extensionCtx.dispose();
		await browserCtx.rebuild();
		await browserCtx.dispose();
		await focusWebviewCtx.rebuild();
		await focusWebviewCtx.dispose();
		await serverCtx.rebuild();
		await serverCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
