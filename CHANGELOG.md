# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project skeleton: web scene scaffold (Vite, TypeScript, Three.js, Vitest, Playwright), `ProjectTownCore` Swift package, minimal menu bar app, Makefile and CI workflow.
- Voxel town scene: street-grid layout on a miniature base plate, 10 procedurally built building styles, voxel characters for the five session states (running, needs you, just finished, idle, sleeping) with walking transitions and an exit walk, signs with state counts and "+N", a HUD panel, real-time and fixed-cycle day/night, fixed / interval / continuous camera modes with view adjustment, tilt-shift depth of field, FPS limiting, Traditional Chinese and English text.
- Mock mode for the scene with URL scenarios and a lil-gui control panel.
