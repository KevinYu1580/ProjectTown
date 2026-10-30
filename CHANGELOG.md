# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-10-30

### Added

- An app icon: the town's isometric voxel house on a grass-green background, shown in Finder, the Dock and the About window instead of the generic app icon. The menu bar icon is now the same house as a template image instead of the `house.fill` symbol.

### Changed

- The lock screen shows your own wallpaper again instead of the town snapshot: ProjectTown puts your wallpaper back when the screen locks and takes a new snapshot after you unlock.

### Fixed

- Unplugging and plugging back an external display could leave another display with the wrong wallpaper, one that belonged to a different display. ProjectTown now waits for macOS to finish moving desktops between displays before it puts wallpapers back, and never sets a wallpaper on a full-screen app's space.

## [1.2.0] - 2026-10-28

### Added

- People out walking: each strolls a round of its own along the town's sidewalks and zebra crossings and out of town, along the roads into the City's neighbourhood or through the gates to the farms in the Countryside (fewer there), keeping right and waiting at the kerb now and then. They look like the town's people but wear muted, greyish clothes instead of pastel ones, have no name or symbol and go indoors by night, so they are not mistaken for your sessions.
- Pigs in some of the Countryside's pastures.

### Changed

- Wallpaper snapshots of a desktop or display that has not been seen for a week are deleted, so old snapshots no longer pile up in `~/Library/Application Support/ProjectTown/Wallpaper/`.
- The "!" bubble over a waiting person is about a third smaller, and project signs and name labels are now drawn over every status symbol (gear, "!", zZ), so a symbol never hides a name.
- The Countryside's sheep, cows and pigs wander from spot to spot as they graze, on their own pasture or hill tier.
- More traffic in the City: more cars on the streets and in the parking lots.

### Fixed

- Switching to a full-screen app while ProjectTown was taking a wallpaper snapshot could set the snapshot as the wallpaper of that app's space instead of the desktop's. ProjectTown now checks with the window server that the town is still on the same desktop before it sets the wallpaper.

## [1.1.0] - 2026-10-27

### Added

- A **Theme** setting: Countryside (the default) or City. City puts the town back in a neighbourhood, now far more varied: detached houses of many sizes and roof shapes, row houses, small apartment blocks, corner shops, workshops, a school with a sports field, a church, parks, playgrounds, plazas and parking lots, with the taller buildings kept away from the town so it stays the focus.
- **Blur strength** (25–200%) and **Blur range** sliders under the depth-of-field switch. The range blurs a band along the top and the bottom of the screen (0–45% of its height each, 25% by default), more toward the edge; the town itself always stays sharp.
- **Show the town while switching desktops** (on by default): macOS sometimes shows the system wallpaper for a moment while you switch desktops or open Mission Control, so ProjectTown sets the system wallpaper of its display to a recent snapshot of the town. Turning the option off, quitting, or moving the town to another display puts each desktop's own wallpaper back.

### Changed

- The default surroundings are open countryside: the town stands on a low terrace ringed by a white picket fence with three gated roads. Meadows and pastures with grazing sheep, two cottages with kitchen gardens, groves, wildflowers and a pond lie close by; patchwork fields, a winding river with a stone bridge and a rail bridge, a small train that passes through tunnels now and then, windmills, three farms and a ring of hills lie further out. At night the countryside goes dark and quiet with only a few warm windows, gate lanterns, the passing train and fireflies over the water.
- Depth of field blurs by distance instead of by screen position: the town, its signs and its people stay sharp wherever they are on screen, the scenery beyond it blurs more the farther away it is, things in front of the town blur only slightly, and the strongest blur is about a third weaker. The setting is now called "Depth-of-field blur".
- Street lamps at night have smaller, softer light pools and halos, and the glow around lights is a little weaker.
- The ground runs on past the edge of the diorama as plain grass in both themes, so the view no longer shows the plate's edge against the background.
- New defaults: 15 FPS, the HUD hidden and 60% blur strength. Existing settings are kept.

## [1.0.0] - 2026-10-27

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
