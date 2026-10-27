# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Background neighbourhood around the town: muted houses on garden plots along residential lanes, trees, a pond park and small cars driving the lanes, filling the default view at every orbit angle and giving way to countryside at the plate edge, with sparse warm windows and car lamps at night.
- README with features, screenshots of every session state, install and usage steps, how it works, privacy, known limitations, and build and development notes.

## [0.4.0] - 2026-10-27

### Added

- Traditional Chinese and English for the menu bar, settings window and messages, following the system language (Simplified Chinese and other languages show English). The wallpaper scene always uses the same language as the app.

### Changed

- The `PROJECTTOWN_WEB_URL` development override only works in Debug builds, so Release builds can only load the bundled scene.

## [0.3.0] - 2026-10-27

### Changed

- The "Needs you" state comes straight from Claude Code's session files, which set `status: "waiting"` while Claude waits for you (verified with Claude Code 2.1.308). No hooks are needed.

### Removed

- The disabled Claude hooks placeholder in the Status tab of Settings.

## [0.2.0] - 2026-10-27

### Added

- Settings window with Projects, Appearance, Status and General tabs: add, remove, reorder and edit projects, scene appearance, status thresholds, display selection and launch at login.
- Adjust View: set the town camera on the wallpaper from the menu bar or the Appearance tab; the view is saved to the config.
- Settings are validated before they are saved; invalid values are rejected with a message next to the control.

### Changed

- The menu bar Settings item opens the settings window instead of `config.json`, and Adjust View is enabled.

## [0.1.0] - 2026-10-27

### Added

- Project skeleton: web scene scaffold (Vite, TypeScript, Three.js, Vitest, Playwright), `ProjectTownCore` Swift package, minimal menu bar app, Makefile and CI workflow.
- Voxel town scene: street-grid layout on a miniature base plate, 10 procedurally built building styles, voxel characters for the five session states (running, needs you, just finished, idle, sleeping) with walking transitions and an exit walk, signs with state counts and "+N", a HUD panel, real-time and fixed-cycle day/night, fixed / interval / continuous camera modes with view adjustment, tilt-shift depth of field, FPS limiting, Traditional Chinese and English text.
- Mock mode for the scene with URL scenarios and a lil-gui control panel.
- Session reading: `SessionReader` parses Claude Code session files, `ProcessChecker` detects live Claude Code processes, `ProjectMatcher` maps sessions to configured projects, and `SessionStateDeriver` and `TownStateBuilder` turn them into the town state fed to the scene.
- `ConfigStore` loads and saves the app config file (`config.json`).
- Desktop wallpaper window that renders the town scene in a `WKWebView` below the desktop icons, with polling that keeps the scene in sync with live sessions.
- Menu bar menu with settings (opens `config.json` for now), pause, reload scene and about items.
- Release workflow (`release.yml`) that builds a universal ad-hoc signed app on `v*` tags and publishes a GitHub release, with release notes taken from this file by `scripts/changelog-section.sh`.
