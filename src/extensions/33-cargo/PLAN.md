# 33-cargo — Cargo Run

> Built on 2026-11-18. This file records the decisions and how the module works, for anyone (or any new chat) picking it up.
> Read `AGENTS.md` at the repo root first. 33-cargo reuses `32-rust` for finding cargo and blocking toolchain downloads.

## The problem it solves

`cargo run` in a terminal ties the build to the running app. To see a change: Ctrl+C (the window closes), type `cargo run`, wait. If the new code doesn't compile, the app is already gone.

Cargo Run **builds first** and swaps the app only when the build works:

```
▶ / Alt+G / Ctrl+G
  → save open files (task.saveBeforeRun), cancel a build already going
  → cargo build --message-format=json-diagnostic-rendered-ansi --package P --bin B
      ├─ fails → the running app keeps running; errors in the terminal + Problems/underlines
      └─ works → stop the old app (whole process tree) → start the new executable
```

It starts the executable itself (not `cargo run`) because `cargo run` would have to close the old app before knowing whether the build works.

## Decisions (agreed with the user)

| Topic | Decision | Why |
| --- | --- | --- |
| Buttons | **editor title**, left of the ATM ghost (`navigation@-2`): green ▶ when idle, green spinning squares while building, red ■ while the program runs. SVGs in `assets/svg/` (VS Code's debug colours, light + dark) | The user's request; menu codicons can't be coloured. A **stop** square, not pause: it ends the program and can't be resumed |
| Spinner | 8 small squares fading like a comet tail, turned in 8 **discrete** 45° steps by SMIL (`calcMode="discrete"`, 0.8 s) | About 10 repaints a second, nothing interpolated, so it costs almost nothing. Green = "on its way to ▶" |
| Clicking the spinner | Cancels **only the build** (`atm.cargo.cancelBuild`); a running program keeps running. Alt+G still stops everything | You see the spinner while refreshing; cancelling a refresh shouldn't close your app |
| Where ▶ shows | `.rs`, any `.toml`, `Cargo.lock`, `rust-toolchain`, and only when the file is inside a Cargo project (`atm.cargo.project`) | The user's request: only Rust/Cargo files |
| Keys | **Alt+G** run/stop (toggle), **Ctrl+G** restart, Ctrl+Alt+G stop | Same keys as Run Dev (JS), so there's one habit to learn |
| Key conflict with Run Dev | Keys follow the **active file**: inside a Cargo project → Cargo Run, otherwise → Run Dev (`!atm.cargo.project` added to Run Dev's keybindings) | In a Tauri project, a `.rs` file runs Cargo, a `.ts` file runs the dev server |
| Restart on save | Setting `atm.cargo.restartOnSave`, **off** by default | Saving halfway through a change shouldn't close the window, and on a 7 GB machine a build on every Ctrl+S adds up. Ctrl+G is the main way |
| Status bar | Its own item (left, priority 39, after Go Live). **Hidden when idle**; shows building / running / failed. Click = Alt+G | The ▶ in the title is how you start; the status bar reports state and lets you stop from any file |
| Terminal | One "Cargo Run" pseudoterminal, **cleared at every build** | The errors on screen are always the latest ones |
| Program cwd | The **workspace root** (where Cargo.lock is) | Same as typing `cargo run` there, so `assets/` paths work |
| Official rust-analyzer extension | Cargo Run works with or without it | It doesn't need rust-analyzer. Only the ▶ Run above `main()` (32-rust) is off while that extension is installed |
| Tauri | Not special-cased | Cargo Run builds and starts the Rust binary exactly like `cargo run` in `src-tauri/`. For the full `tauri dev` (frontend server + app), use Run Dev from a `.ts` file |
| Cargo task list | `cargo run` stays in Run Task (32-rust) | It's harmless there |

## Which program runs

Decided once per Run (`core/programs.ts` → `chooseProgram`), from `cargo metadata --no-deps` (cargo resolves globs, auto-bins and default-members itself):

1. A ▶ Run button above `main()` names its program (32-rust hands off through the `atm.cargo.run` command).
2. The open file is a program's main file (`src/main.rs`, `src/bin/x.rs`, `examples/x.rs`).
3. The open file's package has one binary, or a `default-run`.
4. The program picked last time in this workspace (workspaceState).
5. The workspace has one binary: what plain `cargo run` would start. **This covers the user's example-ide**: editing `crates/ui/src/lib.rs` runs `example-ide`.
6. Otherwise a quick pick, remembered. **ATM: Cargo Run — Choose Program** changes it.

Restart (Ctrl+G) always rebuilds the program that is already running, whatever file is open.

## Layout

```
33-cargo/
├── index.ts               activateCargo(): controller + commands
├── assets/svg/            play-{dark,light}.svg, stop-{dark,light}.svg
├── core/                  pure logic, no VS Code API, unit-tested
│   ├── metadata.ts        cargo metadata JSON → workspace, packages, programs
│   ├── programs.ts        chooseProgram, parseRunArgs (▶ Run hand-off), buildArgs
│   ├── buildOutput.ts     cargo's JSON lines → messages, artifacts, finished
│   ├── problems.ts        rustc JSON diagnostics → Problems (macro spans mapped back to the call)
│   ├── environment.ts     the env cargo run gives a program (CARGO_MANIFEST_DIR, library path…)
│   ├── saveFilter.ts      which saves trigger restart-on-save
│   ├── lineInput.ts       typing in the terminal: echo, Backspace, Enter, Ctrl+D
│   └── paths.ts           path comparisons (case-insensitive on Windows)
├── host/
│   ├── runner.ts          CargoRunner: the build → retire → launch state machine. No VS Code API (tests drive it)
│   ├── build.ts           one `cargo build` run: output, diagnostics, executable
│   ├── processTree.ts     spawn as a process group; stop the whole tree (SIGTERM → SIGKILL / taskkill /T)
│   ├── cargoTools.ts      cargo metadata, `rustc --print target-libdir` (both with RUSTUP_AUTO_INSTALL=0)
│   ├── session.ts         request → RunSession (workspace, program, cargo); remembers the choice
│   ├── projects.ts        nearest Cargo.toml for a file (cached per folder; reset when a Cargo.toml is added/removed)
│   ├── controller.ts      VS Code glue: settings, saves, trust, context keys, save-before-run
│   └── commands.ts        command registration + argument parsing (Uri from the title, Runnable from 32-rust)
└── ui/
    ├── terminal.ts        CargoTerminal (RunnerView): the pseudoterminal
    ├── statusBar.ts       CargoStatusBar
    ├── problems.ts        DiagnosticCollection `atm-cargo`
    └── programPicker.ts   quick pick of programs
```

`RunnerPhase`: `idle` · `building` · `running` · `stale` (build failed, the old app still runs) · `failed` · `crashed`.

## Contributions

- Commands: `atm.cargo.run`, `atm.cargo.stop`, `atm.cargo.cancelBuild`, `atm.cargo.toggle`, `atm.cargo.restart`, `atm.cargo.selectProgram`, `atm.cargo.showOutput`.
- Context keys: `atm.cargo.project` (the active file is in a Cargo project; with no editor: something is running), `atm.cargo.running` (building or running), `atm.cargo.building` (a build is going: the title shows the spinner instead of ■).
- Settings: `atm.cargo.enabled` (true), `atm.cargo.restartOnSave` (false), `atm.cargo.buildArgs` ([]), `atm.cargo.programArgs` ([]).
- Strings go through `vscode.l10n.t`. Like 32-rust, no translations were added to `l10n/bundle.l10n.*.json` yet.

## Gotchas handled

- **No toolchain downloads.** Every cargo/rustc process gets `RUSTUP_AUTO_INSTALL=0` (`32-rust/core/rustup.ts`), including the program. A missing pinned toolchain shows rustup's message in the terminal and a notification.
- **GUI apps start children**, so stopping kills the process group (POSIX) or the tree (`taskkill /T /F`), with SIGKILL after 2 s.
- **Windows locks a running .exe.** The program runs from a copy (`app.atm-run.exe`) in the same folder, so the next build can replace `app.exe`, and DLLs/assets next to it are still found. *Not tested on Windows yet.*
- **The `cargo run` environment** is rebuilt: CARGO, CARGO_MANIFEST_DIR/PATH, CARGO_PKG_NAME/VERSION(+parts), and the library path (`target/<profile>/deps`, `target/<profile>`, the toolchain's lib folder) for `dylib` / Bevy `dynamic_linking`.
- **Progress bar:** stderr is a pipe, so `CARGO_TERM_PROGRESS_WHEN=always` + the terminal's width are passed; compiler text clears the progress line before printing.
- **Two builds on one `target/`:** a new build waits for the cancelled one to exit before starting.
- **Workspace trust:** nothing builds in an untrusted folder; Run offers "Manage Workspace Trust".
- **stdin:** typing in the terminal goes to the program, line by line, with echo; Ctrl+C = Stop; closing the terminal = Stop.

## Tests

`src/__test__/cargo.test.ts` uses no VS Code API, so it runs in the VS Code runner (`bun run test`) and under plain mocha:

```
npx esbuild src/__test__/cargo.test.ts --bundle --platform=node --format=cjs --outfile=<scratch>/cargo.test.js
npx mocha --ui tdd <scratch>/cargo.test.js
```

19 tests: metadata, program choice (including the example-ide layout), ▶ Run args, build output parsing, problems, environment (Linux/Windows/macOS), save filter, line input, and one **real cargo** run (skipped without cargo): start → a broken build keeps the old process alive → a fixed build swaps in a new process → typed input reaches it → cancelling a rebuild leaves it running → Stop kills it.

## Ideas, not done

- A ↻ button next to ■ in the editor title while running (Ctrl+G and the status bar tooltip cover it today).
- Translations in `l10n/bundle.l10n.*.json`.
- Treat path dependencies outside the workspace (`../other-crate`) as restart-on-save triggers.
- Verify on Windows and macOS.

## Working with this user

- Say "**the rust-analyzer program** (part of Rust, not an extension)".
- **Their PC has 7 GB of RAM**, usually with under 1 GB free while developing. Don't add background tools; Cargo Run runs nothing until the user presses Run.
- Never install or download anything without asking.
- They appreciate notes on *why* things work the way they do (they are building their own IDE in Rust).
