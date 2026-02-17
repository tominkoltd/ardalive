# ArdaLive

**Lightning-fast HTML live preview** in your browser while editing in VS Code.  
No full page reloads. No extra tooling. Just type and watch your page update instantly.

CSS hot-swap for linked stylesheets is included as a bonus.

---

## ✨ Features

- **Live HTML preview** — diffs and updates `<body>` in place (keeps scroll, focus, JS state).
- **CSS hot-swap** — linked `.css` files are swapped via blob URLs without a flash.
- Works with plain HTML/CSS, no frameworks required.
- Local HTTP + WebSocket server, auto-starts with VS Code.
- Status indicator in the VS Code status bar.
- MIT licensed, includes [morphdom](https://github.com/patrick-steele-idem/morphdom).

---

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace.  
2. Open your project folder in VS Code.  
3. Check the **ArdaLive** status bar item for the local preview URL.  
4. Open your browser to `http://localhost:<port>`  
   - If you open the root, you’ll see the init page.  
   - You can also open specific `.html` files directly.

Start editing your `.html` file — changes to the `<body>` appear instantly in the browser.

---

## 🛠 How It Works

- A lightweight client script connects to the ArdaLive WebSocket server.
- When you edit an HTML file, only the `<body>` content is sent to the browser.
- The browser uses **morphdom** to patch the live DOM in place.
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
- Inline `<style>` tags in `<head>` are not updated (planned for a future release).
- Runs on `localhost` only — no remote connections.
- If your HTML has multiple `<body>` tags (please don't 😏), only the first is updated.
- Works on macOS, Linux, and Windows.

---

## 📅 Roadmap

- Live updates for inline `<style>` tags.
- `<head>` diff for meta/script/link changes.
- Optional multi-client sync (scroll, form state).

---

## 📜 License

- **ArdaLive** © 2025–2026 Thomas Webb / Tominko Ltd — [MIT License](LICENSE)
- Includes **morphdom** © 2014-2023 Patrick Steele-Idem — MIT License

---