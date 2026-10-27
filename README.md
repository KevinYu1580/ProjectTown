# ProjectTown

A macOS live wallpaper that turns your Claude Code sessions into a tiny voxel town.

<!-- TBD: hero screenshot or GIF (night scene, docs/screenshots/) -->

**Supported languages: 繁體中文, English**

## Features

TBD: session state mapping, day/night modes, camera modes, privacy switches.

## Requirements

TBD: macOS 14+, Claude Code (tested with 2.1.308).

## Install

TBD: download from Releases, then remove the quarantine attribute (the app is not notarized).

## Usage

TBD: open Settings from the menu bar, add project folders.

## How it works

ProjectTown reads `~/.claude/sessions/*.json` once a second. Claude Code keeps one file there for each running session, with its working directory, status and name.

- Each session goes to the project whose folder contains its working directory; the deepest matching folder wins.
- The process ID in the file is checked to make sure the session is still running. The process start time is compared too, so a reused process ID is not mistaken for an old session.
- The file's `status` drives the character: `busy` is Running, and `waiting` is Needs you. Claude Code sets `waiting` while it waits for you, for example at a permission prompt. `idle` shows as Just finished for a while after the session did some work, then Idle, then Sleeping.

No hooks are needed, and ProjectTown never writes to `~/.claude`.

> **Warning:** `~/.claude/sessions` is an undocumented internal format of Claude Code. A Claude Code update may change it and stop ProjectTown from seeing your sessions.

## Privacy

TBD: everything is read locally, no network connections, conversation content is never read.

## Build from source

TBD: Xcode, Node LTS, XcodeGen, then `make app`.

## Development

TBD: `make dev`, `make check`, project structure.

## Contributing

CI runs on GitHub Actions (`.github/workflows/ci.yml`): a `web` job (typecheck, lint, unit tests, e2e) and a `swift` job (`swift test`, `xcodegen`, `xcodebuild build`). Two limitations apply while the repository is private:

1. **Actions minutes quota.** Private repositories get a monthly free quota of Actions minutes (2000), and macOS runners are billed at 10x. To save minutes, the `swift` job only runs when Swift-related files change (`app/**`, `Packages/**`, `project.yml`, `Makefile`, `.github/workflows/**`).
2. **No branch protection.** GitHub Free private repositories cannot enforce branch protection or rulesets, so "CI must pass before merge" is enforced by convention: wait for green CI before merging your own PR. Once the repository is public, branch protection on `main` will require both the `web` and `swift` checks to pass.

## Disclaimer

ProjectTown is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic.

## License

MIT. See [LICENSE](LICENSE).
