# 33-cargo — Plan (context for a new chat)

> Written on 2026-11-18, before any code. This folder is empty except for this file.
> Read this first, then `AGENTS.md` at the repo root, then `src/extensions/32-rust/`.

## Goal

Add a **Cargo Run** button to the status bar for Rust apps (the user builds cross-platform desktop apps, Tauri-style layouts):

1. One click starts the app.
2. **Auto-restart on save:** saving a Rust file rebuilds and relaunches the app.
3. **If the build fails, the old app keeps running.** Show the errors; don't close the window.
4. A **Stop** button.
5. **The app never opens twice.** Only one copy runs at a time, wherever Run was started from.

## What already exists (reuse, don't rewrite)

| Need | Where | Notes |
| --- | --- | --- |
| Find `cargo` on PATH or `~/.cargo/bin` | `32-rust/host/toolchain.ts` → `findTool('cargo', cwd)`, `toolCommand('cargo')` as the fallback | Cached; `cwd` matters for `rust-toolchain.toml`. |
| **Never let rustup download a toolchain** | `32-rust/core/rustup.ts` → `NO_AUTO_INSTALL` | Put it in the env of **every** cargo process (build, metadata, the app). Without it, a project whose `rust-toolchain.toml` pins a missing version makes rustup silently download it (zed pins 1.98.1: ~1.5 GB, happened by accident on 2026-11-18). |
| ▶ Run / Run Test above `main()` | `32-rust/providers/runLens.ts` (buttons), `32-rust/ui/commands.ts` → `run()` (command `atm.rust.run`) | ATM's own CodeLens, found by the lexer (`core/runTargets.ts`). No rust-analyzer. |
| Which bin/example a file belongs to | `32-rust/core/cargoTarget.ts` → `findFileTarget()` | Follows Cargo's layout and `[[bin]]` paths; checked against `cargo metadata` on the user's projects. |
| Runnable → process | `32-rust/core/runnables.ts` → `buildRunnable()`, `runnableToProcess()` | `cargoArgs[0] === 'run'` means it's the app, not a test. |
| Terminal without a folder | `32-rust/ui/runTerminal.ts` | Pseudoterminal; VS Code runs no tasks outside a folder. |
| Cargo tasks + error matcher | `32-rust/providers/cargoTasks.ts`, `package.json` | Task type `atm-cargo`, matcher `$atm-rustc`. Finds `Cargo.toml` at the root or one level down (Tauri's `src-tauri/`). |
| Kill a whole process tree | `26-27/pages/run-dev/core/process-tree.ts` | Process group on POSIX, `taskkill /T` on Windows. GUI apps spawn children, so `child.kill()` isn't enough. |
| Status bar runner with states | `26-27/pages/run-dev/` (`host/controller.ts`, `host/statusbar.ts`, `host/dev-terminal.ts`) | Closest existing pattern: start, running, error, failed, stop. |
| Rust settings section | `package.json` → `atm.rust.*` | 32-rust is **off** when the official `rust-lang.rust-analyzer` extension is installed. |

## Proposed flow

```
Run clicked / file saved
  → debounce (~300 ms); cancel a build already in progress
  → cargo build --message-format=json-diagnostic-rendered-ansi
      ├─ fails → keep the old app running, show errors, status bar "Build failed"
      └─ ok    → read the executable path from the JSON
               → stop the old app (whole process tree)
               → start the new executable directly (not `cargo run`)
               → status bar "Running <name>" (click = Stop)
```

Why `build`, then launch, instead of `cargo run`: `cargo run` builds and launches in one step, so the old app would have to be closed **before** we know whether the build works.

**Reading the JSON** (one object per line on stdout):

- `{"reason":"compiler-artifact", "executable": "...", "target": {"kind": ["bin"], "name": "..."}}` gives the binary path.
- `{"reason":"compiler-message", "message": {"rendered": "..."}}` holds the coloured error text for the terminal.
- `{"reason":"build-finished", "success": true|false}` is the result.

**Status bar states:** Idle `▶ Cargo Run` · Building (spinner) · Running `■ <app>` · Build failed, old app still running (warning colour) · App exited/crashed (error colour).

## Hand-off from 32-rust

- In `32-rust/ui/commands.ts` → `run()`: if `cargoArgs[0] === 'run'`, call `vscode.commands.executeCommand('atm.cargo.run', …)` instead of starting a task. The runnable already says which package and `--bin`/`--example` to build.
- Fall back to the current behaviour if `atm.cargo.run` isn't registered (e.g. the feature is turned off).
- **Run Test stays in 32-rust.**
- Talk through a command, not imports, so the modules stay decoupled (26-27 does the same).

## Gotchas to handle

- **Windows locks a running `.exe`.** `cargo build` can't overwrite `target/debug/app.exe` while it runs ("Access is denied"). Launch a **copy** of the binary (e.g. under `target/debug/.atm-run/`) so the build can replace the original. Linux and macOS don't have this problem.
- **rustup downloads.** Every cargo process (build, metadata, the app) gets `NO_AUTO_INSTALL` from `32-rust/core/rustup.ts`. If the project's toolchain is missing, show rustup's message; never download it silently.
- **Two cargos on one `target/` folder.** Only if the user installs the official rust-analyzer extension: it runs `cargo check` on save while we build, and cargo locks `target/` ("Blocking waiting for file lock"). ATM itself no longer runs rust-analyzer (removed 2026-11-18), so just show cargo's message.
- **Several binaries/packages.** A workspace can have many `[[bin]]`s. For the open file, `32-rust/core/cargoTarget.ts` → `findFileTarget()` already knows its bin. Otherwise use `cargo metadata --no-deps --format-version 1` (with `NO_AUTO_INSTALL`), ask once with a picker, and remember the choice per workspace.
- **Which saves count:** `.rs`, `Cargo.toml` and `build.rs` inside the project folder. Never anything in `target/`.
- **Workspace trust:** building runs code (`build.rs`, proc macros). Only when the workspace is trusted, like 32-rust.
- **No folder open:** VS Code tasks don't work, so use a pseudoterminal (see `runTerminal.ts`). Plan to always use a pseudoterminal for the app; it's simpler.
- **stdin:** forward terminal input to the app so CLI programs work. Ctrl+C = Stop.
- **The new app crashes on start:** the old one is already closed at that point. That's acceptable; just show the exit code.

## Open questions (ask before building)

1. Its own status bar item, or merge into the existing **Go Live (Dev)** pill (`26-27/host/statusbar.ts`)?
2. Should Cargo Run work while the **official rust-analyzer extension** is installed (32-rust is off then)? It doesn't need rust-analyzer.
3. **Tauri:** `cargo tauri dev` / `npm run tauri dev` has its own watcher. Detect it and hand over, or ignore it for now?
4. Is restart-on-save on by default? Setting name, e.g. `atm.cargo.run.restartOnSave`.
5. Keep or remove the plain `cargo run` entry in the Cargo task list?

## Suggested layout (follows `AGENTS.md`)

```
33-cargo/
├── index.ts               activateCargo(context)
├── core/                  pure logic, unit-testable
│   ├── buildMessages.ts   parse cargo JSON lines → executable, messages, success
│   ├── project.ts         find Cargo.toml / binaries (cargo metadata)
│   └── saveFilter.ts      which saved files trigger a rebuild
├── host/
│   ├── runner.ts          build → stop old → launch new; owns the single app process
│   └── processTree.ts     spawn as a group, kill the whole tree
└── ui/
    ├── statusBar.ts
    └── runTerminal.ts     pseudoterminal for build + app output
```

## Checklist

- Register in `src/extensions/extensions.ts` with `safeActivate('cargo', () => activateCargo(context))`.
- Commands `atm.cargo.run` / `atm.cargo.stop`; settings `atm.cargo.*`; add strings to `package.json` **and** every `package.nls*.json`. User-facing text goes through `vscode.l10n.t`.
- Tests: `src/__test__/cargo.test.ts` for `core/` (JSON parsing, save filter, binary choice).
- Style: tabs, semicolons, strict TS.
- Type-check: if `analizar/` exists at the repo root, `bun run check-types` fails (TS6059). Use a throwaway config `{ "extends": "./tsconfig.json", "include": ["src"] }` with `tsc -p`, then delete it.
- Commit style: `🛠️ feat: …`.

## Working with this user

- Say "**the rust-analyzer program** (part of Rust, not an extension)". They first read "rust-analyzer" as the marketplace extension and objected.
- **Their PC has 7 GB of RAM.** rust-analyzer (1.3–2.5 GB on their projects) crashed it, so ATM no longer uses it, and they removed it from rustup. Don't add heavy background tools; ATM reads files, it doesn't index projects.
- One module at a time. Don't touch other modules beyond the small 32-rust hand-off.
- Never install or download anything without asking; an install happens only on their click.
- They want plain explanations and are planning their own IDE in Rust later, so they appreciate notes on *why* things work the way they do.
