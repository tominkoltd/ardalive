# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2025-08-09
### Added
- **HTML live preview** — updates `<body>` content instantly using morphdom (no page reload).
- **Linked CSS hot-swap** — replaces `<link rel="stylesheet">` tags with blob URLs for smooth updates.
- **Local HTTP + WebSocket server** — auto-starts when VS Code is opened.
- Status bar indicator showing server state and active connections.
- Initial settings support: `ardaLive.port` for preferred preview port.
- MIT license and morphdom attribution.

---

[1.0.0]: https://github.com/tominkoltd/ardalive/releases/tag/v1.0.0
