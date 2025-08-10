/**
 * ArdaLive - Live HTML & CSS Preview Server
 * 
 * Created by: Thomas Webb / Tominko Ltd.
 * License: MIT
 * 
 * This is the server-side part of the ArdaLive VS Code extension.
 * It serves HTML/CSS/JS files over HTTP and pushes live changes
 * via WebSockets to connected browsers.
 * 
 * The goal: near-instant in-place updates of HTML and CSS with zero reloads.
 */

const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');
const net = require('net');
const { pipeline } = require('stream');

// Path to static assets bundled with extension
const staticPath = path.join(__dirname, 'static');

// MIME types map for HTTP server
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8',
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.bmp': 'image/bmp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.eot': 'application/vnd.ms-fontobject',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.ogg': 'video/ogg',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4'
};

// Ports and address (found dynamically)
let PORT_WS = 2428;
let PORT_HTTP = 8242;
let ADDR_HTTP = `http://localhost:${PORT_HTTP}`;

// Runtime state
let WATCHERS = [];       // Active WS connections { socket, file, hash }
let FILES_VIEWS = {};    // { htmlFilePath: [linkedCssFilePaths] }
let FILES_WATCH = {};    // { cssFilePath or htmlFilePath: htmlFilePath }
let statusBarItem;       // VS Code status bar entry

let status_http = false;
let status_ws = false;

// Regex: find <link href="*.css"> in HTML files
const findCssLinksRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi;


/**
 * Activates the ArdaLive extension.
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
	const cfg = vscode.workspace.getConfiguration('ardaLive');
	const preferredPort = cfg.get('port', 8242);

	// Find available ports
	PORT_HTTP = await findFreePort(preferredPort, preferredPort + 50);
	PORT_WS = await findFreePort(PORT_HTTP + 1, PORT_HTTP + 51);
	ADDR_HTTP = `http://localhost:${PORT_HTTP}`;

	// Status bar init
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = '$(device-desktop) ArdaLive: Starting...';
	statusBarItem.tooltip = `HTTP Server at: ${ADDR_HTTP}`;
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Scan workspace for HTML files and map their linked CSS
	await reScanFiles()

	/* ---------------------------
	   Changes detector
	--------------------------- */
	vscode.workspace.onDidChangeTextDocument((event) => {
		const doc = event.document;

		if (doc.languageId !== 'html' && doc.languageId !== 'css') return;
		if (!FILES_WATCH[doc.fileName]) return;

		const watchersForFile = WATCHERS.filter(w => w.file === FILES_WATCH[doc.fileName]);
		if (watchersForFile.length === 0) return;

		let content = doc.getText();

		// For HTML, send only <body>…</body> content
		if (doc.languageId === 'html') {
			content = content.replace(/^.*?(<body\b[^>]*>[\s\S]*?<\/body\s*>).*$/si, "$1");
		}

		for (const watcher of watchersForFile) {
			if (watcher.socket?.readyState !== 1) continue;
			watcher.socket.send(JSON.stringify({
				file: doc.fileName,
				data: content
			}));
		}
	});

	/* ---------------------------
	   WS server
	--------------------------- */
	const wss = new WebSocket.Server({ host: '127.0.0.1', port: PORT_WS });

	wss.on('connection', (ws) => {
		console.log("new connection")
		let file = null;
		const hash = randomHash();

		// Close if no file message within 1s
		const handshakeTimeout = setTimeout(() => ws.close(), 1000);

		ws.on('message', (msg) => {
			msg = String(msg);

			if (!file) {
				if (!FILES_WATCH[msg]) return ws.close();

				file = msg;
				ws.send(hash);
				clearTimeout(handshakeTimeout);

				WATCHERS.push({ socket: ws, file, hash });
				setStatus();
				return;
			}

			if (msg === "PING") {
				ws.send("PONG");
			}
		});

		ws.on('close', () => {
			WATCHERS = WATCHERS.filter(w => w.hash !== hash);
			setStatus();
		});
		ws.on('error', (err) => {
			console.error("WS Error: ", err)
		});
	});

	/* ---------------------------
	   HTTP server
	--------------------------- */
	const server = http.createServer(async (req, res) => {
		res.setHeader('Connection', 'close');

		const cookies = parseCookies(req.headers.cookie || '');
		let referer = req.headers['referer'] || req.headers['referrer'];
		let url = req.url;

		let basePath = staticPath

		if (url.endsWith(".html")) {
			referer = null
		}

		if (!referer) {
			await reScanFiles()
			cookies['ArdaLive'] = null;
			// Serve init HTML if root requested
			if (url === "/") {
				url = "/init.html"
				res.setHeader('Set-Cookie',
					`ArdaLive=${encodeURIComponent(staticPath)}; Path=/; HttpOnly; SameSite=Lax`
				);
			} else {
				if (!FILES_VIEWS[url]) {
					res.statusCode = 404;
					return res.end('File not found');
				}
				basePath = path.dirname(url);
				res.setHeader('Set-Cookie',
					`ArdaLive=${encodeURIComponent(basePath)}; Path=/; HttpOnly; SameSite=Lax`
				);
			}
		} else {
			basePath = cookies['ArdaLive'];
		}

		// File list
		if (url === "/fl.json") {
			const fileList = JSON.stringify((await vscode.workspace.findFiles('**/*.html')).map(a => (a.path)));
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(fileList, 'utf8'));
			return res.end(fileList);
		}

		// Serve injected client script
		if (url === "/_ardalive.js") {
			let script = fs.readFileSync(path.join(staticPath, "ardalive.js"), 'utf8');
			script = `const ws_port=${PORT_WS}\n` + script;
			res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(script, 'utf8'));
			return res.end(script);
		}

		// Remove base path prefix
		if (url.startsWith(basePath)) url = url.substring(basePath.length);

		// Always disable caching
		res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Expires', '0');
		res.setHeader('Surrogate-Control', 'no-store');

		// For HTML: inject client script
		if (basePath !== staticPath && (url.endsWith(".html") || url.endsWith(".htm"))) {
			if (!fs.existsSync(basePath + url)) {
				res.statusCode = 404;
				return res.end('File not found');
			}
			let html = fs.readFileSync(basePath + url, 'utf8');
			html += '<script type="module" src="/_ardalive.js"></script>';
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(html, 'utf8'));
			return res.end(html);
		}

		// Serve static file
		sendFile(res, basePath + url);
	});

	server.listen(PORT_HTTP, () => {
		status_http = true;
		setStatus();
	});

	context.subscriptions.push({
		dispose: () => {
			server.close();
			wss.close();
		}
	});
}

function deactivate() { }

/* ---------------------------
   Helper functions
--------------------------- */
async function reScanFiles() {
	const VIEWS = {}
	const WATCH = {}
	const files = await vscode.workspace.findFiles('**/*.html');

	for (const file of files) {
		let html;
		try {
			html = fs.readFileSync(file.path, 'utf8');
		} catch {
			continue;
		}

		VIEWS[file.path] = [];
		WATCH[file.path] = file.path; // watch HTML itself

		let baseDir = path.dirname(file.path);
		let match;

		while ((match = findCssLinksRe.exec(html)) !== null) {
			let cssPath = match[1];
			if (!cssPath.startsWith("/")) cssPath = "/" + cssPath;
			cssPath = baseDir + cssPath;

			VIEWS[file.path].push(cssPath);
			WATCH[cssPath] = file.path; // watch CSS but map to HTML
		}
	}
	FILES_VIEWS = { ...VIEWS }
	FILES_WATCH = { ...WATCH }
}

function randomHash(len = 8) {
	return crypto.randomBytes(Math.ceil(len / 2))
		.toString('hex')
		.slice(0, len);
}

function setStatus() {
	let msg = '$(device-desktop) ArdaLive: ';
	msg += status_http ? `Ready${WATCHERS.length ? ` (${WATCHERS.length})` : ''}` : 'Disconnected';
	statusBarItem.text = msg;
}

function findFreePort(start = 3000, end = 3100) {
	return new Promise((resolve, reject) => {
		const tryPort = (port) => {
			if (port > end) return reject(new Error('No free port found'));
			const srv = net.createServer();
			srv.unref();
			srv.on('error', () => tryPort(port + 1));
			srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
		};
		tryPort(start);
	});
}

function parseCookies(raw) {
	return Object.fromEntries(
		raw.split('; ').map(c => {
			const [key, ...v] = c.split('=');
			return [key, decodeURIComponent(v.join('='))];
		})
	);
}

function sendFile(res, filePath) {
	return new Promise((resolve) => {
		fs.stat(filePath, (err, stat) => {
			if (err || !stat.isFile()) {
				res.statusCode = 404;
				res.end('File not found');
				return resolve();
			}
			const ext = path.extname(filePath).toLowerCase();
			res.statusCode = 200;
			res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
			res.setHeader('Content-Length', stat.size);
			const stream = fs.createReadStream(filePath);
			pipeline(stream, res, (err) => {
				if (err) {
					console.error('Stream error:', err.message);
					if (!res.headersSent) {
						res.statusCode = 500;
						res.end('Server error');
					} else {
						res.destroy();
					}
				}
				resolve();
			});
		});
	});
}

module.exports = { activate, deactivate };