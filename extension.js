/**
 * ArdaLive - Live HTML & CSS Preview Server
 * Version: 1.4.2
 *
 * Created by: Thomas Webb / Tominko Ltd.
 * License: MIT
 *
 * This is the server-side part of the ArdaLive VS Code extension.
 * It serves HTML/CSS/JS files over HTTP and pushes live changes
 * via WebSockets to connected browsers.
 *
 * The goal: near-instant in-place updates of HTML and CSS with zero reloads.
 *
 * Changes in 1.4.1:
 *  - File list no longer goes stale: files created, renamed, deleted or
 *    saved-as inside the editor update the index immediately via the
 *    workspace file events (onDidCreate/Delete/RenameFiles,
 *    onDidSaveTextDocument), independent of the filesystem watcher.
 *  - Watchers are attached to the WorkspaceFolder objects and installed
 *    before the first scan, so nothing is missed while it runs.
 *  - /fl.json is served whenever the request has no workspace context
 *    (browsers with a strict referrer policy send no Referer at all).
 *
 * Changes in 1.4.0:
 *  - Client now patches the DOM with idiomorph (replacing morphdom); see
 *    static/ardalive.js for the integration details.
 *
 * Changes in 1.3.0:
 *  - File list page is now a collapsible tree view; /fl.json includes the
 *    active editor file and clients are notified when it changes.
 *  - Unsaved (dirty) document content is pushed to a client as soon as it
 *    registers its links, so a page reload no longer reverts to the
 *    on-disk version until the next keystroke.
 *  - Requests are contained to the workspace root (no ../ traversal).
 *  - Workspace folders added/removed at runtime are now watched.
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

// Path to static assets bundled with extension
const extPath = path.join(__dirname, 'static');

let FILES=[];            // Per-workspace file index, see rescanFiles()
let lastListJSON=null    // Last file list broadcast to list pages

// What the index tracks; the regexes mirror the globs for incremental updates
const INDEX_GLOB = '**/*.{htm,html,shtml,css,js,map,json,wasm,jpg,jpeg,gif,png,webp,avif,svg,svgz,ico,bmp,tiff,woff,woff2,ttf,otf,eot,mp3,ogg,wav,mp4,webm}'
const INDEX_EXCLUDE = '**/{node_modules,.git,.vscode,dist,out,build,coverage}/**'
const INDEX_EXT_RE = /\.(htm|html|shtml|css|js|map|json|wasm|jpe?g|gif|png|webp|avif|svgz?|ico|bmp|tiff|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm)$/i
const INDEX_EXCLUDE_RE = /(^|[\\/])(node_modules|\.git|\.vscode|dist|out|build|coverage)[\\/]/

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
	// Watchers first, then the initial scan: a file created while the scan
	// runs is then still picked up
	watchersInit()
	context.subscriptions.push({ dispose: () => { for (const w of WATCHERS) w.dispose(); WATCHERS=[] } });
	await rescanFiles()
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

		const content = extractLiveContent(doc);

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

	// Tell list pages which file is active in the editor so the tree
	// can expand the closest path to it
	vscode.window.onDidChangeActiveTextEditor(() => {
		broadcast({ command: 'activeFile', active: getActiveFile() })
	}, null, context.subscriptions);

	// Files created / renamed / deleted from inside the editor (explorer,
	// refactorings, workspace edits). These fire reliably even when the
	// filesystem watcher does not, so the index is patched right away and
	// a full rescan reconciles afterwards.
	vscode.workspace.onDidCreateFiles((e) => {
		let changed = false
		for (const uri of e.files) changed = indexAdd(uri) || changed
		if (changed) publishList()
		scheduleRescan()
	}, null, context.subscriptions);

	vscode.workspace.onDidDeleteFiles((e) => {
		let changed = false
		for (const uri of e.files) changed = indexRemove(uri) || changed
		if (changed) publishList()
		scheduleRescan()
	}, null, context.subscriptions);

	vscode.workspace.onDidRenameFiles((e) => {
		let changed = false
		for (const f of e.files) changed = indexRename(f.oldUri, f.newUri) || changed
		if (changed) publishList()
		scheduleRescan()
	}, null, context.subscriptions);

	// "Save As" of an untitled document is not a create event
	vscode.workspace.onDidSaveTextDocument((doc) => {
		if (indexAdd(doc.uri)) {
			publishList()
			scheduleRescan()
		}
	}, null, context.subscriptions);

	// Re-init watchers when workspace folders are added/removed at runtime
	vscode.workspace.onDidChangeWorkspaceFolders(() => {
		watchersInit()
		scheduleRescan(0)
	}, null, context.subscriptions);

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
				// First pass: find which workspace this client belongs to,
				// needed to resolve root-relative paths like /user.css
				let clientWorkspace=null
				for (const lnk in msg.links) {
					const parts=decodeURIComponent(lnk).split("/")
					parts.shift()
					const maybeWs=parts.shift()
					const fwrkSp=localWorkspace(maybeWs)
					if (fwrkSp) { clientWorkspace=fwrkSp; break }
				}
				for (const lnk in msg.links) {
					// Strip leading empty segment, extract workspace name, keep the rest
					let linkUrl=decodeURIComponent(lnk).split("/")
					linkUrl.shift()
					let wkrSpace=linkUrl.shift()
					linkUrl=linkUrl.join("/")
					// Guard: the first URL segment may not be a workspace name
					// at all (root-relative links like /user.css)
					let fwrkSp=localWorkspace(wkrSpace)
					if (!fwrkSp && clientWorkspace) {
						// Root-relative path (e.g. /user.css, /img/icon.svg):
						// resolve against the client's workspace
						fwrkSp=clientWorkspace
						linkUrl=wkrSpace+(linkUrl?'/'+linkUrl:'')
					}
					if (fwrkSp) {
						// Always add "/" — on Windows the replaceAll below converts
						// forward slashes to backslashes, so this works cross-platform
						let realPath=fwrkSp.path.replace(/[/\\]+$/, '')+"/"+linkUrl
						if (isWindows) {
							realPath=realPath.replaceAll("/", "\\")
							if (realPath[0]=="\\") {
								realPath=realPath.substring(1)
							}
						}
						CLIENTS[hash].files[realPath]=msg.links[lnk]
					}
				}
				// Push unsaved (dirty) editor content for the files just
				// registered — a freshly (re)loaded page got the on-disk
				// version and would otherwise show stale content until the
				// next keystroke.
				for (const doc of vscode.workspace.textDocuments) {
					if (!doc.isDirty) continue
					if (doc.languageId !== 'html' && doc.languageId !== 'css') continue
					const reg = CLIENTS[hash].files[doc.fileName]
					if (reg && ws.readyState === 1) {
						ws.send(JSON.stringify({
							file: reg.fileName,
							data: extractLiveContent(doc)
						}))
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

		if (referer) {
			referer=decodeURIComponent(referer);
		}

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
		let rootDir=extPath
		let baseUrl=url



		// File list: any request without a workspace context (the list page
		// itself, or a browser that sends no Referer at all)
		if (url === "/fl.json" && !currentWorkspace) {
			const fileList = JSON.stringify({
				workspaces: await getHTMLfiles(),
				active: getActiveFile()
			});
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

		// Serve injected list script (ws_port needed for reloadList)
		if (url === "/_list.js") {
			let script = fs.readFileSync(path.join(extPath, 'list.js'), 'utf8');
			script = `const ws_port=${PORT_WS}\n` + script;
			res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
			res.setHeader('Content-Length', Buffer.byteLength(script, 'utf8'));
			return res.end(script);
		}

		if (currentWorkspace) {
			const wksp=workspaces.find(a=>(a.name==currentWorkspace))
			if (wksp && wksp.uri.scheme === 'file') {
				realPath=wksp.uri.path
				rootDir=wksp.uri.fsPath
				// Only strip the workspace prefix when the URL actually contains it.
				// Root-relative URLs (e.g. /user.css, /img/icon.svg) are kept as-is
				// so they resolve correctly against the workspace root.
				const wsPrefix='/'+currentWorkspace
				if (baseUrl===wsPrefix || baseUrl.startsWith(wsPrefix+'/')) {
					baseUrl=baseUrl.substring(currentWorkspace.length+1)
				}
			} else {
				currentWorkspace=null
			}
		}

		// baseUrl is either the full URL (static assets, starts with "/")
		// or the workspace-relative path (also starts with "/")
		if (isWindows) {
			realPath+=baseUrl
			if (realPath[0]=="/") {
				realPath=realPath.substring(1)
			}
		} else {
			realPath+=baseUrl
		}

		// Decoded URLs may contain ../ sequences — refuse anything that
		// resolves outside the workspace (or the extension's static dir)
		const resolvedPath = path.resolve(realPath)
		const relToRoot = path.relative(path.resolve(rootDir), resolvedPath)
		if (relToRoot === '..' || relToRoot.startsWith('..'+path.sep) || path.isAbsolute(relToRoot)) {
			res.statusCode = 403;
			return res.end('Forbidden');
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
		name: folder.name,
		scheme: folder.scheme,
		files: folder.files.filter(file =>
			file.name.endsWith('.html') ||
			file.name.endsWith('.htm')  ||
			file.name.endsWith('.shtml')
		).map(a=>(a.name))
	}));
}

/**
 * Content pushed to clients for a document: full text for CSS,
 * <head> (inline styles) + <body> for HTML.
 */
function extractLiveContent(doc) {
	let content = doc.getText();
	if (doc.languageId === 'html') {
		const headMatch = content.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/si);
		const bodyMatch = content.match(/<body\b[^>]*>[\s\S]*?<\/body\s*>/si);
		if (headMatch || bodyMatch) {
			content = (headMatch ? headMatch[0] : '') + (bodyMatch ? bodyMatch[0] : '');
		}
	}
	return content;
}

/**
 * The file currently focused in the editor, as { workspace, file }
 * (workspace-relative), or null when none / not part of a workspace.
 */
function getActiveFile() {
	const ed = vscode.window.activeTextEditor
	if (!ed || ed.document.uri.scheme !== 'file') return null
	const wksp = vscode.workspace.getWorkspaceFolder(ed.document.uri)
	if (!wksp) return null
	return {
		workspace: wksp.name,
		file: vscode.workspace.asRelativePath(ed.document.uri, false)
	}
}

let WATCHERS=[]

/**
 * One filesystem watcher per local workspace folder: catches changes made
 * outside the editor (git checkout, build output, another application).
 */
function watchersInit() {
	for (const w of WATCHERS) w.dispose()
	WATCHERS=[]
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (folder.uri.scheme !== 'file') continue
		const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
		watcher.onDidCreate((uri) => { if (indexAdd(uri)) publishList(); scheduleRescan() });
		watcher.onDidDelete((uri) => { if (indexRemove(uri)) publishList(); scheduleRescan() });
		// A change to a file the index doesn't know is a create that was missed
		watcher.onDidChange((uri) => { if (indexAdd(uri)) { publishList(); scheduleRescan() } });
		WATCHERS.push(watcher);
	}
}

let scanTimer=null
let scanning=false
let scanAgain=false

/** Debounced full rescan: a burst of file events collapses into one scan. */
function scheduleRescan(delay=250) {
	if (scanTimer) clearTimeout(scanTimer)
	scanTimer=setTimeout(() => { scanTimer=null; rescanFiles() }, delay)
}

/**
 * Rebuild FILES from a workspace search. This is the authoritative index;
 * the index* helpers only keep it current between scans.
 */
async function rescanFiles() {
	if (scanning) { scanAgain=true; return }
	scanning=true
	try {
		const folders = []
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			if (folder.uri.scheme !== 'file') {
				folders.push({
					name: folder.name,
					path: folder.uri.path,
					scheme: folder.uri.scheme,
					files: []
				})
				continue
			}
			const found = await vscode.workspace.findFiles(
				new vscode.RelativePattern(folder, INDEX_GLOB),
				INDEX_EXCLUDE
			);
			const files = found.map((file) => ({
				name: vscode.workspace.asRelativePath(file, false),
				fsPath: file.fsPath,
				path: file.path
			}));
			sortFiles(files)
			folders.push({
				name: folder.name,
				path: folder.uri.fsPath,
				files: files
			})
		}
		folders.sort((a, b) => a.name.localeCompare(b.name))
		FILES=folders
		publishList()
	} catch (e) {
		console.error('ArdaLive: workspace scan failed:', e)
	} finally {
		scanning=false
		if (scanAgain) { scanAgain=false; scheduleRescan(0) }
	}
}

/** Top-level files first, then by name (asRelativePath always uses "/"). */
function sortFiles(files) {
	files.sort((a, b) => {
		const aHasFolder = /[\\/]/.test(a.name);
		const bHasFolder = /[\\/]/.test(b.name);
		if (aHasFolder !== bHasFolder) return aHasFolder - bHasFolder;
		return a.name.localeCompare(b.name);
	});
}

/** Tell list pages to re-fetch, but only when the list actually changed. */
function publishList() {
	const listJSON = JSON.stringify(FILES.map(f => ({ name: f.name, files: f.files.map(x => x.name) })))
	if (listJSON === lastListJSON) return
	lastListJSON = listJSON
	broadcast({ command: 'reloadList' })
}

function broadcast(msg) {
	const data = JSON.stringify(msg)
	for (const clHash in CLIENTS) {
		const cl = CLIENTS[clHash]
		if (cl && cl.socket && cl.socket.readyState === 1) cl.socket.send(data)
	}
}

/** A local (file-scheme) workspace folder by name, as { name, path }. */
function localWorkspace(name) {
	const wf = (vscode.workspace.workspaceFolders ?? []).find(f => f.name === name && f.uri.scheme === 'file')
	return wf ? { name: wf.name, path: wf.uri.fsPath } : null
}

/** The FILES entry for the workspace folder containing uri, if local. */
function indexFolder(uri) {
	if (!uri || uri.scheme !== 'file') return null
	const wf = vscode.workspace.getWorkspaceFolder(uri)
	if (!wf) return null
	return FILES.find(f => f.name === wf.name && !f.scheme) || null
}

/** True when a workspace-relative path is one the index tracks. */
function indexTracks(rel) {
	return INDEX_EXT_RE.test(rel) && !INDEX_EXCLUDE_RE.test(rel)
}

/** Add one file. False when not tracked, not a plain file, or already known. */
function indexAdd(uri) {
	const folder = indexFolder(uri)
	if (!folder) return false
	const rel = vscode.workspace.asRelativePath(uri, false)
	if (!indexTracks(rel)) return false
	if (folder.files.some(f => f.fsPath === uri.fsPath)) return false
	try { if (!fs.statSync(uri.fsPath).isFile()) return false } catch (e) { return false }
	folder.files.push({ name: rel, fsPath: uri.fsPath, path: uri.path })
	sortFiles(folder.files)
	return true
}

/** Remove a file, or everything under a folder. */
function indexRemove(uri) {
	const folder = indexFolder(uri)
	if (!folder) return false
	const root = uri.fsPath.replace(/[\\/]+$/, '')
	const before = folder.files.length
	folder.files = folder.files.filter(f => f.fsPath !== root && !f.fsPath.startsWith(root + path.sep))
	return folder.files.length !== before
}

/** Re-key a renamed file, or a folder and its contents. */
function indexRename(oldUri, newUri) {
	const folder = indexFolder(oldUri)
	if (!folder || indexFolder(newUri) !== folder) {
		// Moved out of, into or between workspace folders: delete + create
		const removed = indexRemove(oldUri)
		const added = indexAdd(newUri)
		return removed || added
	}
	const oldRoot = oldUri.fsPath.replace(/[\\/]+$/, '')
	const newRoot = newUri.fsPath.replace(/[\\/]+$/, '')
	let changed = false
	const kept = []
	for (const f of folder.files) {
		let rest = null
		if (f.fsPath === oldRoot) rest = ''
		else if (f.fsPath.startsWith(oldRoot + path.sep)) rest = f.fsPath.slice(oldRoot.length)
		if (rest === null) { kept.push(f); continue }
		const uri = vscode.Uri.file(newRoot + rest)
		const name = vscode.workspace.asRelativePath(uri, false)
		changed = true
		if (!indexTracks(name)) continue   // e.g. page.html -> page.txt
		kept.push({ name, fsPath: uri.fsPath, path: uri.path })
	}
	folder.files = kept
	sortFiles(folder.files)
	// e.g. page.txt -> page.html: not indexed before, tracked now
	if (indexAdd(newUri)) changed = true
	return changed
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