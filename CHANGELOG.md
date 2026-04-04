# Changelog

All notable changes to this project will be documented in this file.

The format follows a simple version-section structure so GitHub Actions can extract the release notes automatically.

## [0.1.3] - 2026-04-04

### Fixed

- Fixed the packaged Electron renderer entry to use relative Vite asset paths so the Windows desktop app no longer opens to a blank white screen after installation.

## [0.1.2] - 2026-04-04

### Fixed

- Adjusted the Windows NSIS installer mode to avoid the blank assisted-installer window seen on some Windows x64 machines.
- Synced the release version tooling so `package-lock.json` now follows `package.json` automatically during release preparation.

## [0.1.1] - 2026-04-04

### Added

- Added a one-command release publish script for version validation, local packaging, git commit, tag creation, and remote push.

### Fixed

- Corrected Windows release artifact selection so GitHub Releases uploads the full NSIS installer instead of a tiny unpacked helper executable.
- Added a size guard for Windows release assets so future packaging mistakes fail fast in CI.

## [0.1.0] - 2026-04-03

### Added

- Initial desktop release of Web Clone Manager.
- Site management with support for `domain`, `entry_url`, and `group` modes.
- Profile clone management with isolated browser storage per profile.
- Embedded browser workspace and external window open mode.
- Floating management drawer and settings drawer.
- GitHub Release based update check and online installer download.
- GitHub Actions workflow for multi-platform release packaging.

### Notes

- macOS release assets include `aarch64`, `x64`, and `universal` DMG builds.
- Linux release assets include `AppImage`, `deb`, and `rpm`.
- Windows release assets include NSIS `.exe` installer packages.
