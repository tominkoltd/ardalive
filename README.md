# ArdaLive

**Lightning-fast HTML live preview** in your browser while editing in VS Code.  
No full page reloads. No extra tooling. Just type and watch your page update instantly.

CSS hot-swap for linked stylesheets is included as a bonus.

---

## ✨ Features

- **Live HTML preview** — diffs and updates `<head>` and `<body>` in place (keeps scroll, focus, JS state).
- **Inline `<style>` and `<head>` updates** — meta, script and style changes in the header hot-update too.
- **CSS hot-swap** — linked `.css` files are swapped via blob URLs without a flash.
- **Workspace file tree** — the index page lists your HTML files as a collapsible folder tree that remembers its state and follows the file you have open in VS Code.
- **No stale reloads** — refreshing the preview shows your unsaved editor content, not the on-disk version.
- Works with plain HTML/CSS, no frameworks required.
- Local HTTP + WebSocket server, auto-starts with VS Code.
- Status indicator in the VS Code status bar.
- MIT licensed, includes [idiomorph](https://github.com/bigskysoftware/idiomorph).

---

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace.  
2. Open your project folder in VS Code.  
3. Check the **ArdaLive** status bar item for the local preview URL.  
4. Open your browser to `http://localhost:<port>`  
   - If you open the root, you’ll see the file tree page.  
   - You can also open specific `.html` files directly.

Start editing your `.html` file — changes appear instantly in the browser.

---

## 🛠 How It Works

- A lightweight client script connects to the ArdaLive WebSocket server (and auto-reconnects if VS Code restarts).
- When you edit an HTML file, the `<head>` and `<body>` content is sent to the browser.
- The browser uses **idiomorph** to patch the live DOM in place — its id-set matching keeps stateful elements (videos, iframes, focused inputs) alive even when surrounding markup moves, and a form input you are typing into on the preview page keeps its value and focus.
- When you edit a linked CSS file, the corresponding `<link>` element is hot-swapped with a blob URL.

---

## 📦 Configuration

You can change the preview port in settings:

| Setting            | Description                         | Default |
|--------------------|-------------------------------------|---------|
| `ardaLive.port`    | Preferred HTTP preview port         | 8242    |

---

## 📋 Notes & Limitations

- HTML live preview is the primary feature.
- CSS updates work **only** for `<link rel="stylesheet">` tags pointing to local files.
- Live updates run on `localhost` only — no remote connections.
- The file tree's open/closed state is stored in your browser (`localStorage`), per preview port.
- If your HTML has multiple `<body>` tags (please don't 😏), only the first is updated.
- Works on macOS, Linux, and Windows.

---

## 📅 Roadmap

- Optional multi-client sync (scroll, form state).
- Preview over the network (serve + WebSocket on LAN interfaces, opt-in).

---

## 📜 License

- **ArdaLive** © 2025–2026 Thomas Webb / Tominko Ltd — [MIT License](LICENSE)
- Includes **idiomorph** © Big Sky Software — Zero-Clause BSD License

---
