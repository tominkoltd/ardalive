# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] - 2026-07-23
### Changed
- **morphdom replaced with [idiomorph](https://github.com/bigskysoftware/idiomorph) v0.7.4** for DOM patching. Idiomorph's id-set matching keeps stateful elements (playing videos, iframes, focused inputs) alive when surrounding id-less markup is inserted, removed or reordered — cases where morphdom would destroy and recreate nodes. Actively maintained (used by Turbo 8 and htmx) and smaller than the morphdom bundle it replaces.
- **Preview page no longer fights user input**: while testing forms in the preview, a focused input keeps its typed value and focus/selection across live updates (`ignoreActiveValue` + `restoreFocus`).
- **Stronger unsaved-CSS protection**: hot-swapped blob stylesheets are now guarded against all three failure modes during a morph — being reverted to the disk href, being removed, or having a duplicate disk-href `<link>` added alongside.
- `<head>` is morphed with idiomorph's `head.style: 'morph'` so inline `<style>`, meta and script changes diff predictably like the rest of the document.

### Docs
- README refreshed: obsolete limitation ("inline `<style>` in `<head>` not updated" — done since 1.2.3) and completed roadmap items (inline style updates, `<head>` diffing) removed; new features (file tree, unsaved-content reloads, reconnect) documented; license attribution updated (idiomorph, 0BSD).

---

## [1.3.1] - 2026-07-23
### Fixed
- **Tree view layout broken**: the styling intended for the non-browsable workspace rows (`flist div`) also matched the tree's `.children` container divs, giving every nesting level a stray floating folder icon, bold text and an extra 62px of padding — deep folders drifted far to the right. Those rules are now scoped to `div[scheme]` only; nesting indents a clean 28px per level.

---

## [1.3.0] - 2026-07-23
### Added
- **Collapsible tree view for the file list**: the preview index page now shows workspaces, folders and subfolders as a proper tree instead of a flat list of full paths. All folders start collapsed; file rows show just the file name (full path on hover).
- **Folder state is remembered**: open/closed state of every folder is persisted in the browser (`localStorage`) and restored on reload and across list refreshes.
- **Follows the active editor file**: `/fl.json` now reports the file focused in VS Code and the server notifies list pages when it changes. The tree expands the closest existing path to that file and highlights it when it is in the list (works for CSS files too — their parent folders are opened as far as they exist).
- **Wider list**: 500px → 600px (+20%), with an ellipsis instead of wrapping for long names.

### Fixed
- **`<body>` attributes stripped on page load**: the initial SSI-expansion morph compared the live DOM against a document parsed from `innerHTML` (whose `<body>` has no attributes), so `style`, `class`, `id` etc. set on the `<body>` tag were silently removed — inline body styling looked ignored and "reverted to the saved version" on every (re)load. The initial morph is now `childrenOnly`.
- **Page reload reverted to the on-disk version**: unsaved editor changes were only pushed on the next keystroke. The server now pushes dirty document content as soon as a client registers its links, so a reloaded page immediately shows what's in the editor.
- **Preview pages never reconnected**: when the WebSocket dropped (e.g. VS Code reload), live updates were dead until a manual page refresh. The client now retries every 2s and re-announces its links on reconnect.
- **Path traversal**: decoded URLs containing `../` could resolve outside the workspace root; such requests are now rejected with 403.
- **Non-local workspace badge never shown**: the workspace `scheme` field checked by the list page was never sent by the server.
- **Workspace folders added at runtime were invisible**: file watchers were only created at startup and only for non-empty folders; they are now rebuilt on workspace-folder changes and empty workspaces are watched too, so the first file added to them appears.
- **List refresh churn**: `reloadList` was broadcast on every file save even when the list content had not changed; it is now only sent when the list actually differs.

---

## [1.2.8] - 2026-03-28
### Fixed
- **CSS background-image disappearing on hot-swap**: relative and root-relative `url(...)` paths inside linked CSS files (e.g. `url(img/favicon.svg)` or `url(/img/favicon.svg)`) were broken when the stylesheet was loaded as a blob URL, because blob URLs have no meaningful base path. All relative and root-relative paths are now rewritten to absolute URLs before the blob is created, so `::before`/`::after` backgrounds, fonts, and other asset references survive every live update.

---

## [1.2.7] - 2026-03-27
### Fixed
- **Live preview broken in multi-root workspaces**: `.code-workspace` URIs with trailing slashes caused the registered file path (`/project//file.html`) to never match `doc.fileName` (`/project/file.html`). Trailing slashes are now explicitly stripped before path concatenation.
- **Root-relative paths returning 404**: links like `<link href="/user.css">` or `<img src="/img/logo.png">` were not resolved against the workspace root when a referer was present. Both file serving and live-update registration now correctly handle root-relative URLs.
- **CSS flicker on hot-swap**: replaced the `href` swap approach with insert-new-then-remove-old so the old stylesheet stays active until the new one is fully painted.
- **Unsaved CSS lost when HTML is edited**: morphdom was resetting `<link rel="stylesheet">` hrefs back to the disk path (losing the in-memory blob URL). Stylesheet `<link>` elements are now excluded from morphdom patching.
- **Images flickering/disappearing on HTML edit**: morphdom was re-fetching unchanged images. Images with an unchanged `src` are now skipped by morphdom.

---

## [1.2.6] - 2026-03-27
### Fixed
- **Live preview broken in multi-root workspaces**: `.code-workspace` files store folder URIs with trailing slashes (e.g. `"/home/user/project/"`). Using `uri.path` preserved that trailing slash, causing double-slash paths (`/project//file.html`) that never matched `doc.fileName` during the `onDidChangeTextDocument` lookup — so live updates were silently dropped. Switched to `uri.fsPath` which is always normalised (no trailing slash, correct OS separators).

---

## [1.2.5] - 2026-03-27
### Fixed
- **Multi-root workspace file list not auto-refreshing**: in workspaces with multiple folders, the file list in the preview index page was only fetched once on load and never updated when files were added, removed, or changed. The list page now connects to the WebSocket server and re-fetches the file list automatically whenever the server rescans the workspace.

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
