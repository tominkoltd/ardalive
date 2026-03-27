# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.3] - 2026-03-27
### Fixed
- **Inline `<style>` in `<head>` not updating live**: changes to CSS inside `<style>` tags in the document `<head>` were silently ignored — only `<body>` content was transmitted over WebSocket. Now both `<head>` and `<body>` are extracted and sent, and the client morphs `document.head` alongside `document.body` so inline header styles hot-update without a page reload.

---

## [1.2.2] - 2026-02-17
### Fixed
- **Windows / file-not-recognised crash**: `newLinks` handler crashed with a null dereference when the workspace name extracted from the URL was not present in the internal file list (e.g. workspaces with no discoverable files were silently skipped). Guard now checked before any property access.
- **Path separator missing on macOS/Linux (newLinks)**: workspace path and relative file path were concatenated without a `/` separator, producing paths like `/Users/…/projectstyles/main.css` that never matched the VS Code document path — live CSS and HTML updates were silently dropped.
- **Path separator missing on macOS/Linux (HTTP server)**: same root cause in the HTTP request handler; `baseUrl` was stripped of its leading `/` by an off-by-one offset (`+2` → now `+1`), so files were resolved to wrong paths and served as 404.
- **Private property access**: `file._fsPath` replaced with the public `file.fsPath` in the file-watcher map.

---

## [1.2.1] - 2025-09-10
### Fixed
- **Path handling**: applied `urldecode` for special characters in file/folder names.  
- **Windows compatibility**: added extra `/` for static paths (Linux adds automatically).

---

## [1.2.0] - 2025-09-08
### Fixed
- **Windows compatibility**: resolved path handling issues for static file loading (extension now works on both Windows and Linux without hacks).

---

## [1.0.0] - 2025-08-09
### Added
- **HTML live preview** — updates `<body>` content instantly using morphdom (no page reload).
- **Linked CSS hot-swap** — replaces `<link rel="stylesheet">` tags with blob URLs for smooth updates.
- **Local HTTP + WebSocket server** — auto-starts when VS Code is opened.
- Status bar indicator showing server state and active connections.
- Initial settings support: `ardaLive.port` for preferred preview port.
- MIT lice
