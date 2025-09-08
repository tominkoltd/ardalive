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

const isWindows=process.platform=='win32'
const SEP=isWindows?"\\":"/"

// Path to static assets bundled with extension
const extPath = path.join(__dirname, 'static');

let FILES=[];
let fchTM=null
let fchWK=false

// MIME types map for HTTP server
const MIME = {
	'.shtml': 'text/html; charset=utf-8',
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

// Ports and address
let PORT_WS;
let PORT_HTTP;
let ADDR_HTTP;

// Runtime state
let CLIENTS = {};       // Active WS connections { socket, file, hash }
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
	await fileWatcherInit(context)
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
	statusBarItem.command = {
		command: 'vscode.open',
		title: 'Open ArdaLive',
		arguments: [vscode.Uri.parse(ADDR_HTTP)]
	}
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	/* ---------------------------
	   Changes detector
	--------------------------- */
	vscode.workspace.onDidChangeTextDocument((event) => {
		const doc = event.document;

		if (doc.languageId !== 'html' && doc.languageId !== 'css') return;

		let content = doc.getText();
		// For HTML, send only <body>…</body> content
		if (doc.languageId === 'html') {
			content = content.replace(/^.*?(<body\b[^>]*>[\s\S]*?<\/body\s*>).*$/si, "$1");
		}

		for (const clHash in CLIENTS) {
			const cl = CLIENTS[clHash]
			if (cl && cl.files && cl.files[doc.fileName]) {
				cl.socket.send(JSON.stringify({
					file: cl.files[doc.fileName].fileName,
					data: content
				}))
			}
		}

	});

	/* ---------------------------
	   WS server
	--------------------------- */
	const wss = new WebSocket.Server({ host: '127.0.0.1', port: PORT_WS });

	wss.on('connection', (ws) => {
		const hash = randomHash();

		CLIENTS[hash] = {
			socket: ws,
			files: {}
		}

		ws.on('message', (msg) => {
			msg = String(msg);

			if (msg === "PING") {
				ws.send("PONG");
				return
			}

			try {
				msg = JSON.parse(msg)
			} catch (e) {
				return
			}

			if (msg['command'] == 'newLinks') {
				for (const lnk in msg.links) {
					let linkUrl=lnk.split("/")
					let wkrSpace=linkUrl[1]
					linkUrl=lnk.substring(wkrSpace.length+2)
					const fwrkSp=FILES.find(a=>(a.name==wkrSpace))
					let realPath=fwrkSp.path+"/"+linkUrl

					if (isWindows) {
						realPath=realPath.replaceAll("/", "\\")
						if (realPath[0]=="\\") {
							realPath=realPath.substring(1)
						}
					}

					if (fwrkSp) {
						CLIENTS[hash].files[realPath]=msg.links[lnk]
					}
				}
			} else if (msg['command'] == 'getContent') {
				// find file
				let fileName=null
				for (const fc in CLIENTS) {
					if (CLIENTS[fc].files) {
						for (const fn in CLIENTS[fc].files) {
							if (CLIENTS[fc].files[fn].fileName==msg['url']) {
								fileName=fn
								break
							}
						}
					}
				}
				if (!fileName) {
					return
				}
				fs.readFile(fileName, 'utf8', (err, data) => {
					if (!err && ws && ws.readyState == 1) {
						ws.send(JSON.stringify({
							file: msg['url'],
							data: data
						}))
					}
				})
			}
			setStatus();
		});

		ws.on('close', () => {
			delete CLIENTS[hash]
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
		res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Expires', '0');
		res.setHeader('Surrogate-Control', 'no-store');

		const workspaces = vscode.workspace.workspaceFolders ?? []
		const wkspList=workspaces.map(a=>(a.name))
		let currentWorkspace=null

		const cookies = parseCookies(req.headers.cookie || '');
		let referer = req.headers['referer'] || req.headers['referrer'] || null;
		let url = decodeURIComponent(req.url);

		if (referer && referer.startsWith(ADDR_HTTP)) {
			referer = referer.substring(ADDR_HTTP.length)
		}

		if (!referer && url=="/") {
			url="/init.html"
		}
		if (!referer || referer=="/") {
			if (url!=="/" && url.indexOf("/",1)!==-1) {
				const maybeWksp=url.split("/")[1]
				if (wkspList.includes(maybeWksp)) {
					currentWorkspace=maybeWksp
				}
			}
		} else {
			if (referer!=="/" && referer.indexOf("/",1)!==-1) {
				const maybeWksp=referer.split("/")[1]
				if (wkspList.includes(maybeWksp)) {
					currentWorkspace=maybeWksp
				}
			}
		}


		let realPath=extPath
		let baseUrl=url



		// File list
		if (url === "/fl.json" && referer=="/") {
			const fileList = JSON.stringify((await getHTMLfiles()));
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(fileList, 'utf8'));
			return res.end(fileList);
		}

		// Serve injected client script
		if (url === "/_ardalive.js") {
			let script = fs.readFileSync(realPath+(isWindows?"\\":"/")+"ardalive.js", 'utf8');
			script = `const ws_port=${PORT_WS}\n` + script;
			res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(script, 'utf8'));
			return res.end(script);
		}

		if (currentWorkspace) {
			const wksp=workspaces.find(a=>(a.name==currentWorkspace))
			if (wksp && wksp.uri.scheme === 'file') {
				realPath=wksp.uri.path
				baseUrl=baseUrl.substring(currentWorkspace.length+1)
			} else {
				currentWorkspace=null
			}
		}

		if (isWindows) {
			realPath+=(baseUrl.replaceAll("/", "\\"))
			if (realPath[0]=="/") {
				realPath=realPath.substring(1)
			}
		} else {
			realPath+=baseUrl
		}

		
		// For HTML: inject client script
		if (currentWorkspace && (url.endsWith(".html") || url.endsWith(".htm") || url.endsWith(".shtml"))) {
			if (!fs.existsSync(realPath)) {
				res.statusCode = 404;
				return res.end('File not found');
			}
			let html = fs.readFileSync(realPath, 'utf8');
			html += '<script type="module" src="/_ardalive.js"></script>';
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(html, 'utf8'));
			return res.end(html);
		}

		// Serve static file
		sendFile(res, realPath);
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
async function getHTMLfiles() {
	return FILES.map(folder => ({
		...folder,
		files: folder.files.filter(file =>
			file.name.endsWith('.html') ||
			file.name.endsWith('.htm')  ||
			file.name.endsWith('.shtml')
		).map(a=>(a.name))
	}));
}



async function fileWatcherInit(ctx) {
	await fileWatcher()
	for (const WSpace of FILES) {
		const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(WSpace.path, '**/*'));
		watcher.onDidCreate(() => fileWatcher());
		watcher.onDidDelete(() => fileWatcher());
		watcher.onDidChange(() => fileWatcher());
		ctx.subscriptions.push(watcher);		
	}
}

async function fileWatcher() {
	if (fchTM) {
		clearTimeout(fchTM)
	}
	if (fchWK) {
		fchTM=setTimeout(fileWatcher, 500)
		return
	}
	fchWK=true
	try {
		const folders = []
		const workspaces = vscode.workspace.workspaceFolders ?? []
		for (const folder of workspaces) {
			if (folder.uri.scheme !== 'file') {
				folders.push({
					name: folder.name,
					path: folder.uri.path,
					files: []
				})
				continue
			}
			let files = await vscode.workspace.findFiles(
				new vscode.RelativePattern(
					folder,
					'**/*.{htm,html,shtml,css,js,map,json,wasm,jpg,jpeg,gif,png,webp,avif,svg,svgz,ico,bmp,tiff,woff,woff2,ttf,otf,eot,mp3,ogg,wav,mp4,webm}'
				),
				'**/{node_modules,.git,.vscode,dist,out,build,coverage}/**'
			);
			if (files.length == 0) {
				continue
			}

			files = files.map((file) => ({
				name: vscode.workspace.asRelativePath(file.fsPath, false),
				fsPath: file._fsPath,
				path: file.path
			}));

			files.sort((a, b) => {
				const aHasFolder = a.name.includes(SEP);
				const bHasFolder = b.name.includes(SEP);
				if (aHasFolder !== bHasFolder) return aHasFolder - bHasFolder;
				return a.name.localeCompare(b.name);
			});

			folders.push({
				name: folder.name,
				path: folder.uri.path,
				files: files
			})
		}
		if (folders.length > 0) {
			folders.sort((a, b) => {
				return a.name.localeCompare(b.name);
			})
		}
		FILES=[...folders]
	} finally {
		fchWK=false
	}
}


function randomHash(len = 8) {
	return crypto.randomBytes(Math.ceil(len / 2))
		.toString('hex')
		.slice(0, len);
}

function setStatus() {
	let msg = '$(device-desktop) ArdaLive: ';
	const cl = Object.keys(CLIENTS).length
	msg += status_http ? `Ready${cl ? ` (${cl})` : ''}` : 'Disconnected';
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