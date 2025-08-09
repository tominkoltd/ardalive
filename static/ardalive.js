/*
 * ArdaLive - Live HTML Preview Module
 * 
 * Created by: Thomas Webb / Tominko Ltd.
 * License: MIT
 *
 * This module is part of the ArdaLive extension for VS Code,
 * enabling live preview of edited HTML/CSS directly in the browser.
 * It is part of the ArdaForm project.
 * 
 * Includes: morphdom (https://github.com/patrick-steele-idem/morphdom)
 *           Morphdom © 2014-2023 Patrick Steele-Idem, MIT License
 * 
 * For the brave: this code is meant for live DOM patching,
 * updating HTML and CSS in-place at lightning speed, without reloads.
 * Use at your own risk. It bites.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished
 * to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/* --------------------------------------------------------------------------
   Live Preview Client
   --------------------------------------------------------------------------
   Handles WebSocket communication with the ArdaLive server and applies live
   HTML or CSS updates using morphdom and a minimal CSS hot-swap mechanism.
-------------------------------------------------------------------------- */

let socket = null;        // Active WebSocket connection
let initialHash = null;   // Initial handshake hash from server
let pingInterval = null;  // Interval timer for keep-alive pings

// Auto-connect when page is fully loaded
window.addEventListener('load', connectToServer);

/**
 * Establishes a WebSocket connection to the local ArdaLive server.
 */
function connectToServer() {
	if (socket) return; // Already connected or connecting

	socket = new WebSocket(`ws://localhost:${ws_port}`);
	socket.onopen = handleServerOpen;
	socket.onmessage = handleServerMessage;
	socket.onerror = handleServerError;
	socket.onclose = handleServerClose;
}

/**
 * WebSocket: Connection opened.
 */
function handleServerOpen() {
	if (socket?.readyState !== WebSocket.OPEN) return;

	// Send current file path to server for initial sync
	socket.send(location.pathname);

	console.log("%cArdaLive %cconnected", "color: #9b94ff", "color: #80fc03");
}

/**
 * WebSocket: Incoming message from server.
 * @param {MessageEvent} event 
 */
function handleServerMessage(event) {
	// First message after connect = handshake hash
	if (!initialHash) {
		initialHash = event.data;

		// Setup ping every 30s to keep the connection alive
		if (pingInterval) clearInterval(pingInterval);
		pingInterval = setInterval(() => {
			if (socket?.readyState !== WebSocket.OPEN) return;
			socket.send('PING');
		}, 30000);

		return;
	}

	// Ignore keep-alive replies
	if (event.data === "PONG") return;

	// Parse update from server
	const updatePacket = JSON.parse(event.data);

	if (location.pathname === updatePacket.file) {
		// HTML update → morph into current DOM body
		const newDoc = new DOMParser().parseFromString(updatePacket.data, "text/html");
		morphdom(document.body, newDoc.body);
	} else {
		// CSS update → match and hot-swap the correct stylesheet
		const targetHref = location.origin + updatePacket.file;

		for (const sheet of document.styleSheets) {
			const node = sheet.ownerNode;

			if (node._href === targetHref || (node.tagName === 'LINK' && node.href === targetHref)) {
				node._href = targetHref; // Remember original identity for future matches

				const blobUrl = URL.createObjectURL(new Blob([updatePacket.data], { type: 'text/css' }));

				node.addEventListener('load', () => {
					// Revoke blob URL after load to free memory
					setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
				}, { once: true });

				node.href = blobUrl; // Trigger browser to re-parse CSS
				break;
			}
		}
	}
}

/**
 * WebSocket: Connection error.
 * @param {Event} err 
 */
function handleServerError(err) {
	console.error("%cArdaLive %cconnection error: %c" + err,
		"color: #9b94ff", "color: #fc0303ff", "color: #ca0000ff");
}

/**
 * WebSocket: Connection closed.
 */
function handleServerClose() {
	if (pingInterval) clearInterval(pingInterval);
	socket = null;
	initialHash = null;

	console.warn("%cArdaLive %cdisconnected", "color: #9b94ff", "color: #fc0303ff");
}

/* --------------------------------------------------------------------------
   Morphdom Library (Bundled)
   --------------------------------------------------------------------------
   The morphdom library is included below, unmodified, under its original MIT
   license. See: https://github.com/patrick-steele-idem/morphdom
-------------------------------------------------------------------------- */
(function (global, factory) { typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : typeof define === "function" && define.amd ? define(factory) : (global = global || self, global.morphdom = factory()) })(this, function () { "use strict"; var DOCUMENT_FRAGMENT_NODE = 11; function morphAttrs(fromNode, toNode) { var toNodeAttrs = toNode.attributes; var attr; var attrName; var attrNamespaceURI; var attrValue; var fromValue; if (toNode.nodeType === DOCUMENT_FRAGMENT_NODE || fromNode.nodeType === DOCUMENT_FRAGMENT_NODE) { return } for (var i = toNodeAttrs.length - 1; i >= 0; i--) { attr = toNodeAttrs[i]; attrName = attr.name; attrNamespaceURI = attr.namespaceURI; attrValue = attr.value; if (attrNamespaceURI) { attrName = attr.localName || attrName; fromValue = fromNode.getAttributeNS(attrNamespaceURI, attrName); if (fromValue !== attrValue) { if (attr.prefix === "xmlns") { attrName = attr.name } fromNode.setAttributeNS(attrNamespaceURI, attrName, attrValue) } } else { fromValue = fromNode.getAttribute(attrName); if (fromValue !== attrValue) { fromNode.setAttribute(attrName, attrValue) } } } var fromNodeAttrs = fromNode.attributes; for (var d = fromNodeAttrs.length - 1; d >= 0; d--) { attr = fromNodeAttrs[d]; attrName = attr.name; attrNamespaceURI = attr.namespaceURI; if (attrNamespaceURI) { attrName = attr.localName || attrName; if (!toNode.hasAttributeNS(attrNamespaceURI, attrName)) { fromNode.removeAttributeNS(attrNamespaceURI, attrName) } } else { if (!toNode.hasAttribute(attrName)) { fromNode.removeAttribute(attrName) } } } } var range; var NS_XHTML = "http://www.w3.org/1999/xhtml"; var doc = typeof document === "undefined" ? undefined : document; var HAS_TEMPLATE_SUPPORT = !!doc && "content" in doc.createElement("template"); var HAS_RANGE_SUPPORT = !!doc && doc.createRange && "createContextualFragment" in doc.createRange(); function createFragmentFromTemplate(str) { var template = doc.createElement("template"); template.innerHTML = str; return template.content.childNodes[0] } function createFragmentFromRange(str) { if (!range) { range = doc.createRange(); range.selectNode(doc.body) } var fragment = range.createContextualFragment(str); return fragment.childNodes[0] } function createFragmentFromWrap(str) { var fragment = doc.createElement("body"); fragment.innerHTML = str; return fragment.childNodes[0] } function toElement(str) { str = str.trim(); if (HAS_TEMPLATE_SUPPORT) { return createFragmentFromTemplate(str) } else if (HAS_RANGE_SUPPORT) { return createFragmentFromRange(str) } return createFragmentFromWrap(str) } function compareNodeNames(fromEl, toEl) { var fromNodeName = fromEl.nodeName; var toNodeName = toEl.nodeName; var fromCodeStart, toCodeStart; if (fromNodeName === toNodeName) { return true } fromCodeStart = fromNodeName.charCodeAt(0); toCodeStart = toNodeName.charCodeAt(0); if (fromCodeStart <= 90 && toCodeStart >= 97) { return fromNodeName === toNodeName.toUpperCase() } else if (toCodeStart <= 90 && fromCodeStart >= 97) { return toNodeName === fromNodeName.toUpperCase() } else { return false } } function createElementNS(name, namespaceURI) { return !namespaceURI || namespaceURI === NS_XHTML ? doc.createElement(name) : doc.createElementNS(namespaceURI, name) } function moveChildren(fromEl, toEl) { var curChild = fromEl.firstChild; while (curChild) { var nextChild = curChild.nextSibling; toEl.appendChild(curChild); curChild = nextChild } return toEl } function syncBooleanAttrProp(fromEl, toEl, name) { if (fromEl[name] !== toEl[name]) { fromEl[name] = toEl[name]; if (fromEl[name]) { fromEl.setAttribute(name, "") } else { fromEl.removeAttribute(name) } } } var specialElHandlers = { OPTION: function (fromEl, toEl) { var parentNode = fromEl.parentNode; if (parentNode) { var parentName = parentNode.nodeName.toUpperCase(); if (parentName === "OPTGROUP") { parentNode = parentNode.parentNode; parentName = parentNode && parentNode.nodeName.toUpperCase() } if (parentName === "SELECT" && !parentNode.hasAttribute("multiple")) { if (fromEl.hasAttribute("selected") && !toEl.selected) { fromEl.setAttribute("selected", "selected"); fromEl.removeAttribute("selected") } parentNode.selectedIndex = -1 } } syncBooleanAttrProp(fromEl, toEl, "selected") }, INPUT: function (fromEl, toEl) { syncBooleanAttrProp(fromEl, toEl, "checked"); syncBooleanAttrProp(fromEl, toEl, "disabled"); if (fromEl.value !== toEl.value) { fromEl.value = toEl.value } if (!toEl.hasAttribute("value")) { fromEl.removeAttribute("value") } }, TEXTAREA: function (fromEl, toEl) { var newValue = toEl.value; if (fromEl.value !== newValue) { fromEl.value = newValue } var firstChild = fromEl.firstChild; if (firstChild) { var oldValue = firstChild.nodeValue; if (oldValue == newValue || !newValue && oldValue == fromEl.placeholder) { return } firstChild.nodeValue = newValue } }, SELECT: function (fromEl, toEl) { if (!toEl.hasAttribute("multiple")) { var selectedIndex = -1; var i = 0; var curChild = fromEl.firstChild; var optgroup; var nodeName; while (curChild) { nodeName = curChild.nodeName && curChild.nodeName.toUpperCase(); if (nodeName === "OPTGROUP") { optgroup = curChild; curChild = optgroup.firstChild; if (!curChild) { curChild = optgroup.nextSibling; optgroup = null } } else { if (nodeName === "OPTION") { if (curChild.hasAttribute("selected")) { selectedIndex = i; break } i++ } curChild = curChild.nextSibling; if (!curChild && optgroup) { curChild = optgroup.nextSibling; optgroup = null } } } fromEl.selectedIndex = selectedIndex } } }; var ELEMENT_NODE = 1; var DOCUMENT_FRAGMENT_NODE$1 = 11; var TEXT_NODE = 3; var COMMENT_NODE = 8; function noop() { } function defaultGetNodeKey(node) { if (node) { return node.getAttribute && node.getAttribute("id") || node.id } } function morphdomFactory(morphAttrs) { return function morphdom(fromNode, toNode, options) { if (!options) { options = {} } if (typeof toNode === "string") { if (fromNode.nodeName === "#document" || fromNode.nodeName === "HTML" || fromNode.nodeName === "BODY") { var toNodeHtml = toNode; toNode = doc.createElement("html"); toNode.innerHTML = toNodeHtml } else { toNode = toElement(toNode) } } else if (toNode.nodeType === DOCUMENT_FRAGMENT_NODE$1) { toNode = toNode.firstElementChild } var getNodeKey = options.getNodeKey || defaultGetNodeKey; var onBeforeNodeAdded = options.onBeforeNodeAdded || noop; var onNodeAdded = options.onNodeAdded || noop; var onBeforeElUpdated = options.onBeforeElUpdated || noop; var onElUpdated = options.onElUpdated || noop; var onBeforeNodeDiscarded = options.onBeforeNodeDiscarded || noop; var onNodeDiscarded = options.onNodeDiscarded || noop; var onBeforeElChildrenUpdated = options.onBeforeElChildrenUpdated || noop; var skipFromChildren = options.skipFromChildren || noop; var addChild = options.addChild || function (parent, child) { return parent.appendChild(child) }; var childrenOnly = options.childrenOnly === true; var fromNodesLookup = Object.create(null); var keyedRemovalList = []; function addKeyedRemoval(key) { keyedRemovalList.push(key) } function walkDiscardedChildNodes(node, skipKeyedNodes) { if (node.nodeType === ELEMENT_NODE) { var curChild = node.firstChild; while (curChild) { var key = undefined; if (skipKeyedNodes && (key = getNodeKey(curChild))) { addKeyedRemoval(key) } else { onNodeDiscarded(curChild); if (curChild.firstChild) { walkDiscardedChildNodes(curChild, skipKeyedNodes) } } curChild = curChild.nextSibling } } } function removeNode(node, parentNode, skipKeyedNodes) { if (onBeforeNodeDiscarded(node) === false) { return } if (parentNode) { parentNode.removeChild(node) } onNodeDiscarded(node); walkDiscardedChildNodes(node, skipKeyedNodes) } function indexTree(node) { if (node.nodeType === ELEMENT_NODE || node.nodeType === DOCUMENT_FRAGMENT_NODE$1) { var curChild = node.firstChild; while (curChild) { var key = getNodeKey(curChild); if (key) { fromNodesLookup[key] = curChild } indexTree(curChild); curChild = curChild.nextSibling } } } indexTree(fromNode); function handleNodeAdded(el) { onNodeAdded(el); var curChild = el.firstChild; while (curChild) { var nextSibling = curChild.nextSibling; var key = getNodeKey(curChild); if (key) { var unmatchedFromEl = fromNodesLookup[key]; if (unmatchedFromEl && compareNodeNames(curChild, unmatchedFromEl)) { curChild.parentNode.replaceChild(unmatchedFromEl, curChild); morphEl(unmatchedFromEl, curChild) } else { handleNodeAdded(curChild) } } else { handleNodeAdded(curChild) } curChild = nextSibling } } function cleanupFromEl(fromEl, curFromNodeChild, curFromNodeKey) { while (curFromNodeChild) { var fromNextSibling = curFromNodeChild.nextSibling; if (curFromNodeKey = getNodeKey(curFromNodeChild)) { addKeyedRemoval(curFromNodeKey) } else { removeNode(curFromNodeChild, fromEl, true) } curFromNodeChild = fromNextSibling } } function morphEl(fromEl, toEl, childrenOnly) { var toElKey = getNodeKey(toEl); if (toElKey) { delete fromNodesLookup[toElKey] } if (!childrenOnly) { var beforeUpdateResult = onBeforeElUpdated(fromEl, toEl); if (beforeUpdateResult === false) { return } else if (beforeUpdateResult instanceof HTMLElement) { fromEl = beforeUpdateResult; indexTree(fromEl) } morphAttrs(fromEl, toEl); onElUpdated(fromEl); if (onBeforeElChildrenUpdated(fromEl, toEl) === false) { return } } if (fromEl.nodeName !== "TEXTAREA") { morphChildren(fromEl, toEl) } else { specialElHandlers.TEXTAREA(fromEl, toEl) } } function morphChildren(fromEl, toEl) { var skipFrom = skipFromChildren(fromEl, toEl); var curToNodeChild = toEl.firstChild; var curFromNodeChild = fromEl.firstChild; var curToNodeKey; var curFromNodeKey; var fromNextSibling; var toNextSibling; var matchingFromEl; outer: while (curToNodeChild) { toNextSibling = curToNodeChild.nextSibling; curToNodeKey = getNodeKey(curToNodeChild); while (!skipFrom && curFromNodeChild) { fromNextSibling = curFromNodeChild.nextSibling; if (curToNodeChild.isSameNode && curToNodeChild.isSameNode(curFromNodeChild)) { curToNodeChild = toNextSibling; curFromNodeChild = fromNextSibling; continue outer } curFromNodeKey = getNodeKey(curFromNodeChild); var curFromNodeType = curFromNodeChild.nodeType; var isCompatible = undefined; if (curFromNodeType === curToNodeChild.nodeType) { if (curFromNodeType === ELEMENT_NODE) { if (curToNodeKey) { if (curToNodeKey !== curFromNodeKey) { if (matchingFromEl = fromNodesLookup[curToNodeKey]) { if (fromNextSibling === matchingFromEl) { isCompatible = false } else { fromEl.insertBefore(matchingFromEl, curFromNodeChild); if (curFromNodeKey) { addKeyedRemoval(curFromNodeKey) } else { removeNode(curFromNodeChild, fromEl, true) } curFromNodeChild = matchingFromEl; curFromNodeKey = getNodeKey(curFromNodeChild) } } else { isCompatible = false } } } else if (curFromNodeKey) { isCompatible = false } isCompatible = isCompatible !== false && compareNodeNames(curFromNodeChild, curToNodeChild); if (isCompatible) { morphEl(curFromNodeChild, curToNodeChild) } } else if (curFromNodeType === TEXT_NODE || curFromNodeType == COMMENT_NODE) { isCompatible = true; if (curFromNodeChild.nodeValue !== curToNodeChild.nodeValue) { curFromNodeChild.nodeValue = curToNodeChild.nodeValue } } } if (isCompatible) { curToNodeChild = toNextSibling; curFromNodeChild = fromNextSibling; continue outer } if (curFromNodeKey) { addKeyedRemoval(curFromNodeKey) } else { removeNode(curFromNodeChild, fromEl, true) } curFromNodeChild = fromNextSibling } if (curToNodeKey && (matchingFromEl = fromNodesLookup[curToNodeKey]) && compareNodeNames(matchingFromEl, curToNodeChild)) { if (!skipFrom) { addChild(fromEl, matchingFromEl) } morphEl(matchingFromEl, curToNodeChild) } else { var onBeforeNodeAddedResult = onBeforeNodeAdded(curToNodeChild); if (onBeforeNodeAddedResult !== false) { if (onBeforeNodeAddedResult) { curToNodeChild = onBeforeNodeAddedResult } if (curToNodeChild.actualize) { curToNodeChild = curToNodeChild.actualize(fromEl.ownerDocument || doc) } addChild(fromEl, curToNodeChild); handleNodeAdded(curToNodeChild) } } curToNodeChild = toNextSibling; curFromNodeChild = fromNextSibling } cleanupFromEl(fromEl, curFromNodeChild, curFromNodeKey); var specialElHandler = specialElHandlers[fromEl.nodeName]; if (specialElHandler) { specialElHandler(fromEl, toEl) } } var morphedNode = fromNode; var morphedNodeType = morphedNode.nodeType; var toNodeType = toNode.nodeType; if (!childrenOnly) { if (morphedNodeType === ELEMENT_NODE) { if (toNodeType === ELEMENT_NODE) { if (!compareNodeNames(fromNode, toNode)) { onNodeDiscarded(fromNode); morphedNode = moveChildren(fromNode, createElementNS(toNode.nodeName, toNode.namespaceURI)) } } else { morphedNode = toNode } } else if (morphedNodeType === TEXT_NODE || morphedNodeType === COMMENT_NODE) { if (toNodeType === morphedNodeType) { if (morphedNode.nodeValue !== toNode.nodeValue) { morphedNode.nodeValue = toNode.nodeValue } return morphedNode } else { morphedNode = toNode } } } if (morphedNode === toNode) { onNodeDiscarded(fromNode) } else { if (toNode.isSameNode && toNode.isSameNode(morphedNode)) { return } morphEl(morphedNode, toNode, childrenOnly); if (keyedRemovalList) { for (var i = 0, len = keyedRemovalList.length; i < len; i++) { var elToRemove = fromNodesLookup[keyedRemovalList[i]]; if (elToRemove) { removeNode(elToRemove, elToRemove.parentNode, false) } } } } if (!childrenOnly && morphedNode !== fromNode && fromNode.parentNode) { if (morphedNode.actualize) { morphedNode = morphedNode.actualize(fromNode.ownerDocument || doc) } fromNode.parentNode.replaceChild(morphedNode, fromNode) } return morphedNode } } var morphdom = morphdomFactory(morphAttrs); return morphdom });