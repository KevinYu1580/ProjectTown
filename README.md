# ProjectTown

**English** | [繁體中文](README.zh-Hant.md)

A macOS live wallpaper that turns your Claude Code sessions into a tiny voxel town.

![ProjectTown during the day](docs/screenshots/busy-day.png)

**Supported languages: 繁體中文, English** (the app follows your macOS language; see [Language](#language))

ProjectTown is free and open source. If you enjoy it, you can [buy me a coffee on Ko-fi](https://ko-fi.com/kevinyu1580) ☕

Each project folder you add becomes a building. Each Claude Code session working in that folder becomes a little person in front of it, and what the person does shows the session's state. You can see at a glance which project needs you.

## Features

**Five session states**

| | State | What you see |
|---|---|---|
| <img src="docs/screenshots/state-running.png" width="200" alt="running"> | **Running** | Typing at a desk behind the shop window, with a spinning gear above the head. |
| <img src="docs/screenshots/state-waiting.png" width="200" alt="waiting"> | **Needs you** | Standing at the door under a bouncing yellow "!" bubble, the brightest thing in town, day or night. |
| <img src="docs/screenshots/state-finished.png" width="200" alt="finished"> | **Just finished** | A small burst of fireworks, then a green ring at the feet for 30 minutes (adjustable). |
| <img src="docs/screenshots/state-idle.png" width="200" alt="idle"> | **Idle** | Sitting on the bench by the door, now and then stretching or looking around. |
| <img src="docs/screenshots/state-sleeping.png" width="200" alt="sleeping"> | **Sleeping** | Idle for over 2 hours (adjustable): the person goes inside, one window goes dark and "zZ" drifts out. |

When a session ends, its person walks out to the road and off the map.

**The town**

- The town stands on a low terrace ringed by a white picket fence, in open countryside: meadows and pastures where sheep, cows and pigs wander as they graze, cottages and groves close by, patchwork fields further out, a river with two bridges, a small train that passes now and then, windmills, a few farms and hills all around, so the whole desktop is filled at any camera angle. Nothing out there has a sign. A few people stroll about, through the town and out through the gates to the farms; they look like yours but wear muted clothes instead of pastel ones, have no name or symbol and go indoors by night, so they are never mistaken for your sessions.
- Prefer a city? Set the theme to **City** (Settings → Appearance) and the town sits in a varied neighbourhood instead: houses of many sizes, row houses, small apartment blocks, corner shops, a school, a church, parks and parking lots, with traffic on the streets and people walking the sidewalks, through the town and out into the neighbourhood.
- Ten building styles (office, factory, café, bookstore, lab, warehouse, radio tower, greenhouse, clock tower, ramen shop), picked automatically or chosen per project, with your project color as an accent.
- A glowing sign above each building with the project name and per-state counts, plus "+N" when more people are inside than fit on screen.
- A HUD panel in the bottom-left corner with the session counts of every project. It is off by default; turn it on in Settings → Appearance.
- Session names and "last active" times above each person, hidden by default for privacy.

**Day and night**

![ProjectTown at night](docs/screenshots/busy-night.png)

- **Real time**: follows your clock, with your own sunrise and sunset (default 06:00 and 18:00).
- **Fixed cycle**: a full day every N minutes (5 minutes to 24 hours), with an adjustable share of daylight.

**Camera**

- **Fixed** (default), **Rotate on a timer** (turns 90° every 10 minutes by default), or **Rotate slowly** (a slow orbit, one turn per hour by default).
- **Adjust View** (menu bar or Settings): rotate, zoom and pan the town right on your desktop, or pick one of four preset views, then click **Done**.
- Depth-of-field blur for the miniature look: the scenery behind the town blurs more the farther away it is, and a band along the top and the bottom of the screen blurs too, with adjustable strength (25–200%, 60% by default) and range (0–45% of the screen height, 25% by default). The town itself always stays sharp. It can be turned off.
- **Show the town while switching desktops** (on by default): macOS sometimes shows the system wallpaper for a moment while you switch desktops or open Mission Control. With this option ProjectTown sets the system wallpaper to a recent snapshot of the town, on every desktop of the town's display at once, so you see the town instead, also on desktops you have not visited since. This works with dynamic and aerial wallpapers too. Turning it off puts your own wallpapers back, dynamic and aerial ones included, and so does quitting. The lock screen shows the town too, so nothing switches when you lock or unlock. The snapshot holds only the 3D town: no signs, names or state symbols, so the lock screen does not show your project names or what your sessions are doing. To reach every desktop, ProjectTown edits macOS's own wallpaper settings (`~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`) and restarts the system's wallpaper process, so all displays redraw their wallpaper once when this happens. If a future macOS changes that file, ProjectTown falls back to the current desktop only.
  If another tool also changes your wallpaper (a live or video wallpaper app, a rotating wallpaper, including the one in System Settings, or a Shortcuts or script automation), don't let it manage the town's display, or turn this option off. The two take turns overwriting the same system wallpaper, so you may see the wrong one, and the "own wallpaper" ProjectTown puts back may not be the one you want. ProjectTown only remembers the single picture shown at the time, so a rotating wallpaper does not rotate again after it is put back.

**Light on resources**

- Rendering pauses completely while the desktop is covered (for example by a full-screen app), while the screens sleep, and while you are switched to another user.
- Frame-rate limit: 15, 30 or 60 FPS (default 15).

## Requirements

- macOS 14 Sonoma or later
- [Claude Code](https://code.claude.com) — tested with version 2.1.308. Both the CLI and the desktop app are supported; cloud sessions are not shown.

## Install

1. Download `ProjectTown-vX.Y.Z.zip` from [Releases](https://github.com/KevinYu1580/ProjectTown/releases) and unzip it.
2. Drag `ProjectTown.app` to `/Applications`.
3. The app is ad-hoc signed and not notarized, so macOS blocks it the first time. Remove the quarantine attribute:

   ```bash
   xattr -dr com.apple.quarantine /Applications/ProjectTown.app
   ```

   Or right-click the app in Finder and choose **Open**.

### Updates

You only do this once. ProjectTown checks GitHub for a new release once a day; when one is out, choose **Update to X.Y.Z and Restart** from the menu bar menu (or Settings → General). It downloads the release, checks its signature, moves the old app to the Trash and restarts, with no download or quarantine step for you. Turn off **Check for updates automatically** in Settings → General if you prefer to update by hand. Versions before 1.4.0 cannot update themselves; install 1.4.0 by hand once.

## Usage

1. Open ProjectTown. A house icon appears in the menu bar; the app has no Dock icon.
2. Choose **Open Settings…** from the menu bar icon.
3. In **Projects**, click **+** and pick your project folders. Each folder becomes a building. Any Claude Code session whose working directory is inside a project folder, including worktrees in subfolders, shows up there.
4. That's it — the "Needs you" state works out of the box, no hooks or setup needed.

The menu bar menu also has **Adjust View**, **Pause Rendering**, **Reload Scene** and **Support ProjectTown…**.

## Customization

Everything below is in **Open Settings…** and applies right away.

**Projects**

- **+** / **−**: add project folders (several at once) or remove the selected one. Drag projects in the list to change the order of the buildings in town.
- For each project: **Name** (shown on the sign), **Color** (the building's accent and the sign color) and **Building style** (**Auto** picks one from the folder path, or choose one of the ten styles).

**Appearance**

| Setting | Options | Default |
|---|---|---|
| Day and night → Mode | **Real time** or **Fixed cycle** | Real time |
| Sunrise / Sunset (Real time) | Any time; sunset must be after sunrise | 06:00 / 18:00 |
| Cycle length (Fixed cycle) | 5–1440 minutes | 60 minutes |
| Daytime share (Fixed cycle) | 10–90% | 50% |
| Camera → Mode | **Fixed**, **Rotate on a timer**, **Rotate slowly** | Fixed |
| Turn every (Rotate on a timer) | 1–60 minutes | 10 minutes |
| One rotation takes (Rotate slowly) | 2–60 minutes | 60 minutes |
| View | **Adjust View…** / **Reset View** | — |
| Theme | **Countryside** or **City** | Countryside |
| Depth-of-field blur | On / off | On |
| Blur strength | 25–200% | 60% |
| Blur range | 0–45% of the screen height | 25% |
| Show HUD | On / off | Off |
| Display | Any connected display | Main display |
| FPS | 15, 30, 60 (120 is shown but not available) | 15 |
| Show the town while switching desktops | On / off | On |

**Status**

| Setting | Options | Default |
|---|---|---|
| "Just finished" lasts | 1–240 minutes | 30 minutes |
| Sleeping after | 10–1440 minutes, longer than "Just finished" | 120 minutes |
| Hide session names | On / off | On |

**General**

- **Launch at login** (macOS may ask you to allow it in System Settings → Login Items).
- **Pause rendering**, the same switch as in the menu bar.
- **Check for updates automatically** (on by default), with **Check Now** to look right away. See [Updates](#updates).

### Language

ProjectTown has no language setting of its own: like most Mac apps, it follows macOS. It shows 繁體中文 when Traditional Chinese is your first preferred language and English otherwise. To use a different language for ProjectTown only, open System Settings → General → Language & Region → Applications, add ProjectTown and pick a language, then quit and reopen it.

## How it works

ProjectTown reads `~/.claude/sessions/*.json` once a second. Claude Code keeps one file there for each running session, with its working directory, status and name.

- Each session goes to the project whose folder contains its working directory; the deepest matching folder wins.
- The process ID in the file is checked to make sure the session is still running. The process start time is compared too, so a reused process ID is not mistaken for an old session.
- The file's `status` drives the character: `busy` is Running, and `waiting` is Needs you. Claude Code sets `waiting` while it waits for you, for example at a permission prompt. `idle` shows as Just finished for a while after the session did some work, then Idle, then Sleeping.

No hooks are needed, and ProjectTown never writes to `~/.claude`.

> **Warning:** `~/.claude/sessions` is an undocumented internal format of Claude Code. A Claude Code update may change it and stop ProjectTown from seeing your sessions.

## Privacy

- Everything happens on your Mac. The only network connection is the update check: once a day ProjectTown asks GitHub for the latest release (`api.github.com`), and downloads it from GitHub when you choose to update. Nothing about you or your sessions is sent. Turn it off in Settings → General.
- It reads only `~/.claude/sessions/*.json` (session ID, working directory, status, name and timestamps) and its own settings file. It never reads your conversations, prompts or transcripts, and it never writes to `~/.claude`.
- Session names are hidden on the wallpaper by default (Settings → Status → Hide session names).
- Settings are stored in `~/Library/Application Support/ProjectTown/config.json`. Wallpaper snapshots, and a note of the wallpaper each desktop had before, are kept in `~/Library/Application Support/ProjectTown/Wallpaper/`. With **Show the town while switching desktops** on, ProjectTown also edits the wallpaper entries of macOS's wallpaper settings (`~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`) and nothing else in that file. Snapshots of a desktop or display that has not been seen for a week are deleted.

## Known limitations

- `~/.claude/sessions` is an undocumented Claude Code format; a Claude Code update may break session reading.
- Other live-wallpaper apps draw at the same desktop level and conflict with ProjectTown. Quit them first.
- The town is shown on one display (selectable in Settings).
- WKWebView renders at most about 60 frames per second, so the 120 FPS option is greyed out.
- The app is not notarized (see [Install](#install)).

## Build from source

Requirements: Xcode 16 or later for Swift 6 (developed and tested with Xcode 27.1), Node.js LTS (developed with Node 22), and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
make app
```

This builds the web scene, generates the Xcode project, builds a Debug app into `build/ProjectTown.app` and opens it.

## Contributing

Changes reach `main` only through pull requests; direct pushes are blocked. Run `make check` before opening one.

CI runs on GitHub Actions (`.github/workflows/ci.yml`): a `web` job (typecheck, lint, unit tests, e2e) and a `swift` job (`swift test`, `xcodegen`, `xcodebuild build`). The `swift` job only runs when Swift-related files change (`app/**`, `Packages/**`, `project.yml`, `Makefile`, `.github/workflows/**`).

The pull requests from before the move to this repository (2026-11-08) are kept in [docs/pull-requests-archive.md](docs/pull-requests-archive.md).

## Support

ProjectTown is free and open source, with no paid version. If it brightens your desktop, you can [buy me a coffee on Ko-fi](https://ko-fi.com/kevinyu1580) to keep it growing. The same link is in the menu bar menu and in Settings → General.

## Disclaimer

ProjectTown is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic.

## License

MIT. See [LICENSE](LICENSE).
