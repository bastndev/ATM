# 33-cargo — Cargo Run and the save check

> Built on 2026-11-18; the save check was added the same day. This file records the decisions and how the module works, for anyone (or any new chat) picking it up.
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
| Buttons | **editor title**, left of the ATM ghost (`navigation@-2`): blue ▶ when idle, blue spinning squares while building, Rust-orange ■ while the program runs. SVGs in `assets/svg/`: dark themes `#0090FF` (the Lynx NVIM accent: focusBorder / progressBar) and `#FF7043` (the Rust file icon's orange); light themes `#0069D1` / `#E64A19` for contrast | The user's request. File icons can't follow the theme (VS Code draws them as images) and menu codicons can't be coloured, so the theme's colours are used directly. A **stop** square, not pause: it ends the program and can't be resumed |
| Spinner | 8 small squares fading like a comet tail, turned in 8 **discrete** 45° steps by SMIL (`calcMode="discrete"`, 0.8 s) | About 10 repaints a second, nothing interpolated, so it costs almost nothing. Blue like ▶: "on its way to ▶" |
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

## The save check

**The problem (the user's words, 2026-11-18):** "When I write something wrong and press Ctrl+S, it should mark me red." Before, errors were underlined only after Cargo Run's own build. A wrong line saved with Ctrl+S, or a `cargo run` typed in the terminal, underlined nothing; the only way to find the error was reading the whole terminal.

```
Ctrl+S on a .rs / Cargo.toml / Cargo.lock in a Cargo project
  → wait 200 ms (Save All starts one check)
  → cargo check --workspace --message-format=json-diagnostic-short   (low priority, no colours, no progress)
      ├─ errors/warnings → the same Problems collection as Cargo Run → red/yellow underline + Error Lens
      └─ cargo stopped before checking (broken Cargo.toml, missing toolchain…) → old problems stay,
         cargo's first `error:` line shows in the status bar for 10 s
```

| Topic | Decision | Why |
| --- | --- | --- |
| Command | `cargo check`, not `cargo build` | No code generation and no linking (linking an egui app is the slow part), so it is much lighter than a build. Dependencies are checked once (check artifacts sit next to the build's in `target/`), then each check redoes only the crates that changed |
| Scope | `--workspace` (lib + bins of every member), no `--all-targets` | Changing a library also reports what breaks in the program that uses it. Tests/examples are skipped by default for speed; `atm.cargo.checkArgs: ["--all-targets"]` adds them. `-p` in checkArgs drops `--workspace` |
| One per workspace | A save while a check runs: **warm** (a check finished here this session) and running < 10 s → cancel and restart; otherwise (**cold** first check, maybe checking every dependency, or a long one, e.g. after `cargo clean`) → let it finish, then check again | Restarting a short check loses little and gives the fresh result soonest. Restarting a long one on every save could keep dependency checking from ever finishing |
| Cargo Run | Its build cancels the check; saves made *during* the build are checked after it. Cargo Run's own saves (Save All before building, restart-on-save) are never checked: `CargoController.coversSave()` | Its build reports the same errors, and two cargos on one `target/` only wait for each other |
| Terminal | Shell integration (`onDidStart/EndTerminalShellExecution`, VS Code 1.93+): a command line containing `cargo` **cancels** the check when it starts and **requests** one when it ends. `--manifest-path` is followed | The terminal's text is **not** read: VS Code's `execution.read()` keeps a command's whole output in memory until it ends (a `cargo run` app logging for an hour), and rustc's human format would need a parser. A check after the command gives exact JSON positions. Cancelling at start keeps the user's command from waiting on our lock |
| Problems | One `atm-cargo` collection; each report replaces only **its workspace's** problems (multi-root safe); files whose problems didn't change aren't touched | The latest of build / check / terminal wins; no duplicates, no needless redraws of Error Lens and the Problems panel |
| Stop | Stop no longer clears the problems | They describe the code, which stopping doesn't change |
| Message | The primary span's label is added as the 2nd line ("mismatched types" + "expected `u32`, found `&str`"), unless the message already says it | rustc's own short output adds it too; without it E0308 says only "mismatched types" |
| Priority | `os.setPriority(BELOW_NORMAL)` on cargo; rustc inherits it | Typing stays smooth during a long first check. No `--jobs` cap: that would override the user's own `build.jobs` |
| Progress | `withProgress(ProgressLocation.Window, "cargo check")`: a spinner in the status bar only while a check runs | A long first check is visible; costs nothing when idle |
| Off | `atm.cargo.checkOnSave: false`; never in untrusted folders; never while the rust-analyzer **extension** is installed (it checks on save itself) | Light/off option on a 7 GB machine; no double underlines |

Not done: an initial check when a project is opened (only saves and terminal commands trigger it), reading panics out of program output, a check on Cargo.toml changes made outside the editor.

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
│   ├── problems.ts        rustc JSON diagnostics → Problems (macro spans mapped back to the call), ProblemSink
│   ├── check.ts           checkArgs, isCargoCommand / manifestPathIn (terminal), CargoFailure (the one line to show)
│   ├── environment.ts     the env cargo run gives a program (CARGO_MANIFEST_DIR, library path…)
│   ├── saveFilter.ts      affectsBuild: which saves start a check / restart-on-save
│   ├── lineInput.ts       typing in the terminal: echo, Backspace, Enter, Ctrl+D
│   └── paths.ts           path comparisons (case-insensitive on Windows)
├── host/
│   ├── runner.ts          CargoRunner: the build → retire → launch state machine. No VS Code API (tests drive it)
│   ├── build.ts           one cargo run (`build`, or `check` in background mode): output, diagnostics, executable
│   ├── checker.ts         CargoChecker: when the save check runs (warm/cold, Cargo Run, cancel). No VS Code API
│   ├── checkController.ts VS Code glue for the check: saves, terminal commands, settings, trust, spinner
│   ├── workspaces.ts      cargo metadata per project folder, cached until a Cargo.toml changes
│   ├── processTree.ts     spawn as a process group; stop the whole tree (SIGTERM → SIGKILL / taskkill /T)
│   ├── cargoTools.ts      cargo metadata, `rustc --print target-libdir` (both with RUSTUP_AUTO_INSTALL=0)
│   ├── session.ts         request → RunSession (workspace, program, cargo); remembers the choice
│   ├── projects.ts        nearest Cargo.toml for a file (cached per folder; reset when a Cargo.toml is added/removed)
│   ├── controller.ts      VS Code glue: settings, saves, trust, context keys, save-before-run; BuildActivity for the check
│   └── commands.ts        command registration + argument parsing (Uri from the title, Runnable from 32-rust)
└── ui/
    ├── terminal.ts        CargoTerminal (RunnerView): the pseudoterminal
    ├── statusBar.ts       CargoStatusBar
    ├── problems.ts        DiagnosticCollection `atm-cargo`, per workspace, shared by Cargo Run and the check
    └── programPicker.ts   quick pick of programs
```

`RunnerPhase`: `idle` · `building` · `running` · `stale` (build failed, the old app still runs) · `failed` · `crashed`.

## Contributions

- Commands: `atm.cargo.run`, `atm.cargo.stop`, `atm.cargo.cancelBuild`, `atm.cargo.toggle`, `atm.cargo.restart`, `atm.cargo.selectProgram`, `atm.cargo.showOutput`.
- Context keys: `atm.cargo.project` (the active file is in a Cargo project; with no editor: something is running), `atm.cargo.running` (building or running), `atm.cargo.building` (a build is going: the title shows the spinner instead of ■).
- Settings: `atm.cargo.enabled` (true), `atm.cargo.restartOnSave` (false), `atm.cargo.buildArgs` ([]), `atm.cargo.programArgs` ([]), `atm.cargo.checkOnSave` (true), `atm.cargo.checkArgs` ([]).
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

31 tests: metadata, program choice (including the example-ide layout), ▶ Run args, build output parsing, problems (with labels), environment (Linux/Windows/macOS), save filter, line input, the check's commands, **when the check runs** (fake checks: debounce, cold/warm, Cargo Run's build, terminal cancel, cargo failures), and two **real cargo** runs (skipped without cargo):

- Cargo Run: start → a broken build keeps the old process alive → a fixed build swaps in a new process → typed input reaches it → cancelling a rebuild leaves it running → Stop kills it.
- The check: a type error is reported at the right line/columns with its label → fixing it clears the problems.

The VS Code glue (`checkController.ts`, `ui/problems.ts`) has no automated test; try it in F5.

## Ideas, not done

- A ↻ button next to ■ in the editor title while running (Ctrl+G and the status bar tooltip cover it today).
- Translations in `l10n/bundle.l10n.*.json`.
- Treat path dependencies outside the workspace (`../other-crate`) as restart-on-save triggers.
- Verify on Windows and macOS.

## Working with this user

- Say "**the rust-analyzer program** (part of Rust, not an extension)".
- **Their PC has 7 GB of RAM**, usually with under 1 GB free while developing. Cargo Run runs nothing until the user presses Run. The save check is the only background job, added at the user's request: `cargo check` only, low priority, one per workspace, off with `atm.cargo.checkOnSave`. Don't add more.
- Never install or download anything without asking.
- They appreciate notes on *why* things work the way they do (they are building their own IDE in Rust).
