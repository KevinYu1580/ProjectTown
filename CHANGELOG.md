# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
