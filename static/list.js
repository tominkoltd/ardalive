/* --------------------------------------------------------------------------
   ArdaLive – Workspace File List (Browser)
   - Renders HTML files as a collapsible folder tree (collapsed by default)
   - Open/closed folder state is remembered in localStorage
   - Follows the file focused in VS Code: expands the closest path to it
     and highlights it when it is in the list
---------------------------------------------------------------------------- */

const STATE_KEY = 'ardalive-tree-v1'
let treeState = loadState()   // Map: "workspace/dir/subdir" -> 1 (open)
let lastActiveKey = null      // Last active-file key we auto-expanded for
let loadSeq = 0               // Drops an older /fl.json response that lands last

window.onload = () => {
	loadList()
	connectWS()
}

// A background tab may have missed a reloadList while hidden
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') loadList()
})

function loadState() {
	try {
		return JSON.parse(localStorage.getItem(STATE_KEY)) || {}
	} catch (e) {
		return {}
	}
}

function saveState() {
	try {
		localStorage.setItem(STATE_KEY, JSON.stringify(treeState))
	} catch (e) { /* private mode etc. — tree still works, just not remembered */ }
}

async function loadList() {
	const seq = ++loadSeq
	let resp
	try {
		resp = await (await fetch("/fl.json")).json()
	} catch (e) {
		return
	}
	if (seq !== loadSeq) return   // superseded by a newer request
	const workspaces = Array.isArray(resp) ? resp : (resp.workspaces || [])
	const active = Array.isArray(resp) ? null : resp.active

	const cont = document.getElementsByTagName('flist')[0]
	cont.innerHTML = ""

	if (workspaces.length == 0) {
		cont.textContent = "No html files found in workspace"
		return
	}

	for (const folder of workspaces) {
		if (folder.scheme) {
			// Non-local workspace (e.g. remote/virtual): shown but not browsable
			const row = document.createElement("div")
			row.textContent = folder.name
			row.setAttribute("scheme", folder.scheme)
			cont.appendChild(row)
			continue
		}
		cont.appendChild(renderDir(folder.name, buildTree(folder.files), folder.name, folder.name))
	}

	applyActive(active)
}

/** Nest flat relative paths (either / or \ separated) into a tree. */
function buildTree(paths) {
	const root = { dirs: Object.create(null), files: [] }
	for (const p of paths) {
		const parts = p.split(/[\\/]/)
		const fname = parts.pop()
		let node = root
		for (const seg of parts) {
			node = node.dirs[seg] || (node.dirs[seg] = { dirs: Object.create(null), files: [] })
		}
		node.files.push({ name: fname, path: p })
	}
	return root
}

/** Render one folder as <details><summary>name</summary><div class="children">…</div></details> */
function renderDir(label, node, wsName, key) {
	const det = document.createElement("details")
	det.className = key === wsName ? "wsroot" : "dir"
	det.dataset.key = key
	if (treeState[key]) det.open = true

	const sum = document.createElement("summary")
	sum.textContent = label
	det.appendChild(sum)

	det.addEventListener("toggle", () => {
		if (det.open) treeState[key] = 1
		else delete treeState[key]
		saveState()
	})

	const children = document.createElement("div")
	children.className = "children"

	for (const dirName of Object.keys(node.dirs).sort((a, b) => a.localeCompare(b))) {
		children.appendChild(renderDir(dirName, node.dirs[dirName], wsName, key + "/" + dirName))
	}

	for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
		const fullPath = wsName + "/" + file.path.replace(/\\/g, "/")
		const link = document.createElement("a")
		link.href = "/" + fullPath.split("/").map(encodeURIComponent).join("/")
		link.textContent = file.name
		link.title = fullPath
		link.dataset.path = fullPath
		children.appendChild(link)
	}

	det.appendChild(children)
	return det
}

/** Expand the closest existing path to the active editor file and highlight it.
 *  Works even when the file itself is not listed (e.g. a CSS file): its
 *  parent folders are opened as far as they exist in the tree. */
function applyActive(active) {
	for (const el of document.querySelectorAll("flist a.active")) el.classList.remove("active")
	if (!active || !active.workspace) return

	const norm = String(active.file || "").replace(/\\/g, "/")
	const fullKey = active.workspace + "/" + norm

	const details = document.querySelectorAll("flist details")
	const findDir = (key) => {
		for (const d of details) if (d.dataset.key === key) return d
		return null
	}

	// Only auto-expand when the active file actually changed, so a folder the
	// user closed by hand stays closed
	if (fullKey !== lastActiveKey) {
		lastActiveKey = fullKey
		const parts = fullKey.split("/")
		parts.pop() // drop the file name; expand directories only
		let key = ""
		for (const seg of parts) {
			key = key ? key + "/" + seg : seg
			const det = findDir(key)
			if (!det) break
			det.open = true
			// Persist directly — the 'toggle' event fires async and a
			// re-render could land before it
			treeState[key] = 1
		}
		saveState()
	}

	let link = null
	for (const a of document.querySelectorAll("flist a")) {
		if (a.dataset.path === fullKey) { link = a; break }
	}
	if (link) {
		link.classList.add("active")
		link.scrollIntoView({ block: "nearest" })
	}
}

function connectWS() {
	const ws = new WebSocket(`ws://127.0.0.1:${ws_port}`)
	// (Re)connected: the list may have changed while there was no socket
	// (VS Code restart, extension reload)
	ws.onopen = () => loadList()
	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)
			if (msg.command === 'reloadList') loadList()
			if (msg.command === 'activeFile') applyActive(msg.active)
		} catch(e) {}
	}
	ws.onclose = () => setTimeout(connectWS, 2000)
}
