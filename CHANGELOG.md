# 🏧 ATM Changelog

ATM is a powerful, all-in-one modular extension suite designed to streamline your development workflow. 
It seamlessly integrates productivity enhancements, advanced diagnostics, documentation features, and core editor utilities into a single, cohesive package.

🚀 **Compatibility:** Fully supported on VS Code, Cursor, Windsurf, Trae.ai, Kiro, and Firebase Studio.

🌐 Discover more extensions at [gohit.xyz](https://gohit.xyz/).

## 📋 Changelog

Following best practices, ATM adheres to strict semantic versioning for all updates and releases.

<br>
<!-- --- -->

## [2.1.0] - 2026-11-09

  - Better 01-ai-data-id
  - Better 28-atm-formatter: now only use ".atmformater"

---
## [2.0.4] - 2026-10-31

### Added & Improved (Contribution by **Enrique H. Hernandez** — `@EnriqueHH`)

- **AI Data (`01-ai-data-id`) — Antigravity 2.0 Compatibility**:
  - Added support for the Antigravity 2.0 `RetrieveUserQuotaSummary` RPC endpoint (5-hour and weekly quota buckets) with automatic fallback to `GetUserStatus`.
  - Expanded `ProcessFinder` to detect modern `language_server` / `language_server.exe` binaries, `--csrf-token` / `--csrf_token` variants, and direct `--extension_server_port` CLI flags.
  - Added support and color palettes for modern model families including **Gemini 4 Argon**, **Gemini 3.8 Pro/Flash**, and **Claude 3.7/4.6**.
  - Enabled silent background discovery so `AI Data` coexists seamlessly when running Antigravity 2.0 alongside VS Code, Cursor, or Windsurf.

---
## [2.0.0] - 2026-07-14

### Added

- **Major README refresh**: Rebuilt `README.md` to showcase all 30+ ATM extensions with a Table of Contents, collapsible Preview Gallery, expanded Settings reference, and a Keyboard Shortcuts cheat sheet.
- **Full localization sync**: Updated all 11 localized READMEs in `public/docs/` (AR, DE, ES, FR, HI, JA, KO, PT, RU, VI, ZH) to match the new English source.
- **New documented extensions**: Added descriptions for ATM Focus, Tailwind CSS, Terminal Sound, Bracket Lynx, Git Commands, Compare Code, ATM Browser, NPM Run, Go Live, Run Dev, ATM Formatter, Commit Emoji, and Before After.

### Improved

- **Extension discovery**: README now accurately reflects the full extension count (+30) and replaces the outdated "+21 extensions" claim.

---

## [2.0.3] - 2026-07-17

- **Update**:  Status Bar (ATM) Layout.
 
---

## [2.0.2] - 2026-07-16

- **Better**:  code spell & npm-run.

---

## [2.0.1] - 2026-07-14

### Improved

- **NPM Run**: Migrated publish workflow setup from legacy `NPM_TOKEN` authentication to npm trusted publishing with OIDC, added safe beta publishing, and preserved the automated `dev` to `main` release flow.

---

## [2.0.0] - 2026-07-13

### Added

- **ATM Focus**: Added a productivity dashboard with Pomodoro, YouTube Music, AM Radio, and AI usage tracking.
- **Tailwind CSS**: Added commands to fold and unfold Tailwind class strings and toggle the integration.
- **Terminal Sound**: Added configurable audio feedback for terminal commands through shell integration.
- **Git Commands**: Added an in-editor Git command reference with categories, explanations, and copy actions.
- **Compare Code**: Added side-by-side code comparison tools for quick reviews inside the editor.
- **ATM Browser**: Added an embedded Chromium browser with configurable search and display quality.
- **NPM Run**: Added status-bar actions for automated patch, minor, major, and beta npm releases.
- **Go Live**: Added a local development server with live reload, SPA fallback, HTTPS, and custom headers.
- **Run Dev**: Added framework-aware dev-script detection, execution, and automatic local URL opening.
- **ATM Lint**: Added a lightweight lint engine with suggestion-based Quick Fixes and optional ESLint warnings.
- **ATM Formatter**: Added Prettier-based formatting for TypeScript, TSX, CSS, Astro, and JSON with `.atmignore` support.
- **Commit Emoji**: Added conventional commit emoji insertion, automatic matching, custom entries, and usage sorting.
- **Before After**: Added Git `HEAD` comparison for selected code with copy and restore actions.

---

## [1.9.5] - 2026-05-18

### Added

- **ATM Translate**: Integrated a new, fully modular translation extension. Features a dedicated webview panel, secure API secret management, and a robust suite of translator commands for seamless in-editor text translation.

---

## [1.9.5] - 2026-04-18

### Added

- Improved Tailwind CSS support and detection.
- Enhanced autocomplete and parsing behavior for utility classes.
- Added new dictionary words:
  - `tailwind`
  - `cli`
  - `emit`
  - `vscodeignore`
  - `prettierignore`
  - `keymap`
  - `keymaps`

---

## [1.9.4] - 2026-04-18

### Added

- **Tailwind CSS Integration**: Added Tailwind CSS support with fold commands and configuration options for better class management.
- **Tailwind Fold Commands**: Implemented commands to fold/unfold Tailwind class strings for cleaner code viewing.
- **Dynamic Hover Provider**: Implemented dynamic hover provider registration for supported languages with HTML escaping.
- **Tailwind Icon**: Added new `tainwd-icon.svg` asset for Tailwind-related UI elements.

### Improved

- **Advanced Tooltip Rendering**: Updated tooltip rendering with rich HTML formatting and better visual presentation.
- **SVG Animations**: Enhanced SVG animations with BETA animated features and improved 3-point rendering.
- **Notification Styling**: Improved Tailwind notification CSS for better visual consistency.
- **Hover Provider**: Enhanced hover provider with HTML escaping and updated status bar initialization logic.
- **Performance**: Implemented debounced reparse and update mechanisms for improved performance.
- **Decorator Logic**: Streamlined folded range detection and cursor positioning in decorators.
- **Function Architecture**: Refactored core functions from logic 3 to 4 for better maintainability.

---

## [1.9.3] - 2026-04-17

### Added

- **Terminal Sound Module**: Added audio alerts for terminal error notifications ("T-Sound"). Includes custom sound files (`faah.wav`), process interruption support, and mute/unmute functionality.
- **Music Controls**: Added keybindings and commands for "Random AM station" playback.
- **Ignored Files**: Integrated document exclusion logic to safely ignore unneeded files.

### Improved

- **Status Bar**: Enhanced ATM Control Center UI with improved visual hierarchy, minimal tooltip layouts, and a direct GitHub repository link.
- **Inline Comments**: Supported inline comment highlighting by differentiating between whole-line and inline UI decoration types.
- **Focus UI**: Refined quick-access button animations inside the focus screen and adjusted spacing.
- **Architecture**: Refactored the `00-atm-control-panel` codebase into a scalable modular structure inside `utils`.

---

## [1.9.2] - 2026-04-16

### Improved

- **Terminal Sound**: Enhanced sound file resolution and added process interruption support for the sound player.
- **Status Bar**: Added Terminal Sound audio configuration management and simplified audio UI.

---

## [1.9.1] - 2026-04-15

### Added

- **Global Status Bar**: Centralized status bar items into a unified global hover UI via a new `shared` module. Includes "Normal" and "Pro" layout presets, dynamic auto-refresh, and a debounced architecture.
- **AI Data ID**: Added model family icons to tooltip rows and included exhausted models in summary calculations.

### Improved

- **UI/UX**: Updated hover UI to display "ATM Control Center", streamlined compact mode, and disabled unnecessary animations to boost performance.
- **ESLint**: Added an operational warning visibility toggle and simplified plugin configurations.
- **Music View**: Added a loading transition, inline CSS injection for faster webview startup, and automatic focus to radio mode if no track is selected.

---

## [1.8.6] - 2026-04-08

### Improved

- **Linting**: Added filtering for non-code ESLint warnings to reduce noise and enhanced overall linting feedback.
- **Dependencies**: Updated ESLint configurations and underlying packages.

---

## [1.8.5] - 2026-04-08

### Added

- **Radio & Favorites**: Built an AM station favorites system with UI toggles, state persistence, and URL normalization for seamless music streaming.
- **Audio Visualizer**: Added a 4-bar animated equalizer visualizer to active radio station buttons, synchronized with audio events.
- **Global Music Toggle**: Added a global command to toggle music playback via keyboard shortcuts.

### Improved

- **Music UI Layout**: Center-aligned items in the radio panel, froze primary button widths, and updated the favorite button states for full/empty slots.
- **Status Warnings**: Replaced engine failure diagnostics with window notifications and implemented server-to-client status tracking in the status bar.
- **Iconography**: Updated the main extension icon asset.

---

## [1.8.1] - 2026-04-07

### Added

- **ATM Lint Integration**: Comprehensive native ESLint Language Server integration (client & server) with Astro support, Code Actions for fixes, and workspace-aware `cwd` resolution.
- **Spell Check**: Implemented the Dice coefficient algorithm for significantly improved spell-check suggestion accuracy.
- **Claude Warnings**: Added a Claude peak hour warning badge to the AI data quota tooltip.

### Improved

- **Lint UI**: Reduced left margins for decorators and added rule-based emojis to lint Code Action titles for quicker visual parsing.
- **Performance**: Added document linting debounce, document versioning to prevent stale code actions, and robust LSP client lifecycle management.

---

## [1.8.0] - 2026-04-06

### Added

- **ESLint LSP**: Brought Astro support to the ESLint client document selector and implemented Code Actions.
- **Client/Server ESLint Architecture**: Built the initial build configuration and established client-server communication via a robust LSP setup.
- **AI Data ID**: Added model basket aggregation for more accurate credit consumption tracking.

### Improved

- **Translate Doc**: Added progressive opacity fade-out to the UI, improved translation caching with hash keys and size limits, and fixed a release-notes memory leak.
- **Music View**: Redesigned skeleton loading UI for dynamic layout representations.

---

## [1.7.0] - 2026-04-06

### Added

- **Multi-language Support**: Added translations for `RU`, `PT-BR`, `FR`, and `DE` along with new NLS dictionaries for complete UI coverage.
- **Translate Doc Features**: Added translation abort support, TTS feedback badges, localized media hints, and support for additional languages in the Quick Pick menu.

### Improved

- **Notifications**: Polished notification deletion interactions.
- **I18n Architecture**: Massively refactored to internationalize extension commands and views using NLS localization keys.

---

## [1.6.0] - 2026-04-06

### Improved

- **Iconography**: Redesigned warning icons (e.g., "20% AI data left").
- **Performance**: Stripped unused event activations from the `package.json` map.

---

## [1.5.5] - 2026-04-05

### Added

- **Music UI**: Added an animated music icon to the radio tab button inside the Quick Access menu.

### Improved

- **Focus UI**: Enhanced overall aesthetics with typography tweaks, better tab padding, and customized cursor pointers for music states. Re-balanced the ATM-time display glow, and introduced dynamic playback state animations.

---

## [1.5.1] - 2026-04-05

### Added

- **Streams**: Added and updated several stream URLs for global AM stations, including Singapore and Mexico.
- **Local Stats Tracking**: Replaced GitHub streak calculation with local daily coding streak state management.

### Improved

- **TTS Logic**: Prioritized focused UI element selection over text editor selection during voice invocation.
- **Bento UI**: Refreshed UI elements around streak tracking, renaming default placeholder strings, and ensuring transparent themes mirror VS Code environment vars.

---

## [1.4.0] - 2026-04-03

### Added

- **Comments Code**: Added dynamic gutter icons to comment decorators. Supported styling for specific tag detection patterns (like TODO, FIXME, MARK) and whole-line highlighting with dynamic background generation.
- **Screenshot Code**: Enhanced the screenshot panel with new logic and better CSS layouts. Included ATM brand footers to outputs.

### Improved

- **Image Validation**: Hardened validation logic filtering non-data URIs securely.
- **Split Views**: Guarded against file operation collisions to prevent interference during split-view rename actions.

---

## [1.3.0] - 2026-04-02

### Added

- **Github Bento UI**: Implemented a dynamic heatmap grid rendering with month labels and optimized scrolling behaviors.
- **Performance**: Built a memory cache for data providers to heavily optimize the UI rendering path. Updates now happen via dynamic DOM repaints instead of complete webview reloads.

### Improved

- **Music Visualization**: Swapped out static glow orbs with interactive, frame-driven audio wave animations under the music player.
- **API Reuse**: Prevented webview crashes by securely reusing existing `vscode` API instances from window bounds.

---

## [1.2.6] - 2026-03-31

### Improved

- **Screenshot**: Further centralized VS Code API access points across modules for better stability.

---

## [1.2.5] - 2026-03-31

### Improved

- **Dependencies**: Excluded bloated dependencies from compilation (like `NeteaseCloudMusicApi`), switching strategies for lazy loading instead to drastically decrease the extension bundle load speed.

---

## [1.2.3] - 2026-03-31

### Added

- **Pomodoro Timer**: Introduced Pomodoro functionalities right into the native extension state! Includes UI connections.

### Improved

- **Git Blame**: Hardened Git blame functionality with filters explicitly checking for nested error boundaries.

---

## [1.2.2] - 2026-03-31

### Added

- **Markdown Tools**: Created Markdown image icon providers. Introduced full autocomplete enhancements and better caching behaviors.

### Improved

- **Hover Definitions**: Changed mapped loops to execute sequentially on native components to prevent async collisions during path resolutions inside Hover providers.
- **Decorations**: Optimized decorators by grouping gutters into distinct rendering passes, solving UI tearing during tab switching.

---

## [1.1.2] - 2025-03-17

### Improved

- **Documentation**: Refactored README and improved Spanish (ES) and Chinese (ZH) documentation.

---

## [1.1.1] - 2025-03-13

### Added

- **Documentation**: Added Spanish (ES) and Chinese (ZH) documentation files.

### Improved

- **Iconography**: Updated icons to the "Liquid glass" style.
- Version bumped from 0.1.2 to 1.1.1.

---

## [0.1.2] - 2025-03-13

### Improved

- Enhanced the README with better structure, clear descriptions, and modern design.
- Added images and videos to the documentation for a more visual and engaging experience.

---

## [0.1.1] - 2025-03-13

### Added

- Env Lens extension and commands to reveal and hide `.env` values securely.

### Improved

- General fixes and improvements across existing extensions.
- Stability updates for existing modules and configurations.

---

## [0.0.1] - 2025-03-02

### 🎉 Initial Release

- First public preview of ATM (Advanced Tool Module).
- Creation of the full extension suite and modular architecture.
- Initial release of all ATM extensions and core configurations, ready to use.
- Base command set and integration for VS Code-compatible editors.
