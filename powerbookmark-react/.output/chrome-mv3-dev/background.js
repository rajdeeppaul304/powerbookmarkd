var background = (function() {
	//#region node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	//#endregion
	//#region src/entrypoints/background.js
	var background_default = defineBackground(() => {
		const API = "http://127.0.0.1:8765";
		function setBadge(tabId, state) {
			const states = {
				unsaved: {
					text: "+",
					color: "#888888"
				},
				saved: {
					text: "✓",
					color: "#22c55e"
				},
				archived: {
					text: "📦",
					color: "#3b82f6"
				},
				error: {
					text: "!",
					color: "#ef4444"
				},
				loading: {
					text: "…",
					color: "#f59e0b"
				}
			};
			const s = states[state] || states.unsaved;
			chrome.action.setBadgeText({
				text: s.text,
				tabId
			});
			chrome.action.setBadgeBackgroundColor({
				color: s.color,
				tabId
			});
		}
		const TRACKING = new Set([
			"utm_source",
			"utm_medium",
			"utm_campaign",
			"utm_term",
			"utm_content",
			"fbclid",
			"gclid",
			"ref",
			"source",
			"mc_eid",
			"mc_cid"
		]);
		function normalizeUrl(url) {
			try {
				const u = new URL(url);
				for (const key of [...u.searchParams.keys()]) if (TRACKING.has(key.toLowerCase())) u.searchParams.delete(key);
				u.hash = "";
				u.pathname = u.pathname.replace(/\/+$/, "") || "/";
				return u.toString();
			} catch {
				return url;
			}
		}
		async function lookupTab(tabId, url) {
			if (!url || url.startsWith("chrome://") || url.startsWith("about:")) {
				setBadge(tabId, "unsaved");
				return null;
			}
			setBadge(tabId, "loading");
			try {
				const norm = encodeURIComponent(normalizeUrl(url));
				const res = await fetch(`${API}/lookup?url=${norm}`);
				if (!res.ok) throw new Error("lookup failed");
				const data = await res.json();
				if (data.exists) setBadge(tabId, data.archived ? "archived" : "saved");
				else setBadge(tabId, "unsaved");
				return data;
			} catch {
				setBadge(tabId, "error");
				return null;
			}
		}
		chrome.tabs.onActivated.addListener(async ({ tabId }) => {
			await lookupTab(tabId, (await chrome.tabs.get(tabId)).url);
		});
		chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
			if (change.status === "complete" && tab.active) await lookupTab(tabId, tab.url);
		});
		async function captureScreenshot(tabId) {
			try {
				return await chrome.tabs.captureVisibleTab(null, {
					format: "jpeg",
					quality: 85
				});
			} catch (e) {
				console.error("Screenshot failed:", e);
				return null;
			}
		}
		async function captureHtml(tabId) {
			try {
				await chrome.scripting.executeScript({
					target: { tabId },
					files: ["single-file-bundled.js", "content.js"]
				});
			} catch (e) {
				console.warn("PowerBookmark: script injection failed", e);
				return null;
			}
			await new Promise((r) => setTimeout(r, 150));
			try {
				const response = await chrome.tabs.sendMessage(tabId, { type: "GET_HTML" });
				if (!response || !response.b64) throw new Error("No HTML returned");
				return response.b64;
			} catch (e) {
				console.warn("HTML capture failed after injection:", e);
				return null;
			}
		}
		chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
			(async () => {
				switch (msg.type) {
					case "LOOKUP":
						sendResponse(await lookupTab(msg.tabId, msg.url));
						break;
					case "PROXY_FETCH":
						fetch(msg.url).then(async (res) => {
							const blob = await res.blob();
							const headers = {};
							res.headers.forEach((val, key) => {
								headers[key] = val;
							});
							const reader = new FileReader();
							reader.onloadend = () => {
								sendResponse({
									base64: reader.result,
									headers
								});
							};
							reader.readAsDataURL(blob);
						}).catch((err) => {
							sendResponse({ error: err.message });
						});
						break;
					case "SAVE": {
						const { tabId, url, title, vault, tags, archive, notes, folder_id } = msg;
						let favicon_url = "";
						try {
							favicon_url = (await chrome.tabs.get(tabId)).favIconUrl || "";
						} catch (e) {
							console.warn("Favicon capture failed:", e);
						}
						const screenshotData = await captureScreenshot(tabId);
						let htmlData = null;
						if (archive) htmlData = await captureHtml(tabId);
						try {
							const data = await (await fetch(`${API}/save`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									url,
									title,
									vault,
									tags,
									archive,
									screenshot: !!screenshotData,
									notes,
									folder_id: folder_id || null,
									favicon_url,
									screenshot_data: screenshotData,
									html_data: htmlData
								})
							})).json();
							setBadge(tabId, archive && htmlData ? "archived" : "saved");
							sendResponse({
								success: true,
								...data
							});
						} catch (e) {
							setBadge(tabId, "error");
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					}
					case "OPEN_ITEMS":
						try {
							sendResponse(await openItems({
								action: msg.action,
								groupBy: msg.groupBy,
								groups: msg.groups,
								singleLabel: msg.singleLabel
							}));
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "DELETE":
						try {
							const data = await (await fetch(`${API}/bookmark/${msg.id}`, { method: "DELETE" })).json();
							const tab = await chrome.tabs.get(msg.tabId);
							await lookupTab(msg.tabId, tab.url);
							sendResponse({
								success: true,
								...data
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "SEARCH":
						try {
							sendResponse(await (await fetch(`${API}/search?q=${encodeURIComponent(msg.q)}${msg.vault ? "&vault=" + msg.vault : ""}`)).json());
						} catch (e) {
							sendResponse({
								results: [],
								error: e.message
							});
						}
						break;
					case "GET_VAULTS":
						try {
							sendResponse(await (await fetch(`${API}/vaults`)).json());
						} catch (e) {
							sendResponse({
								vaults: [],
								error: e.message
							});
						}
						break;
					case "GET_RECENT":
						try {
							sendResponse(await (await fetch(`${API}/recent?limit=30`)).json());
						} catch (e) {
							sendResponse({
								bookmarks: [],
								error: e.message
							});
						}
						break;
					case "GET_CONTENTS":
						try {
							const params = new URLSearchParams({ vault: msg.vault || "default" });
							if (msg.folder_id) params.set("folder_id", msg.folder_id);
							sendResponse({
								success: true,
								...await (await fetch(`${API}/contents?${params}`)).json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "CREATE_FOLDER":
						try {
							const res = await fetch(`${API}/folders`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									name: msg.name,
									parent_id: msg.parent_id || null,
									vault: msg.vault || "default"
								})
							});
							if (!res.ok) {
								sendResponse({
									success: false,
									error: (await res.json()).detail || "Create failed"
								});
								break;
							}
							sendResponse({
								success: true,
								folder: await res.json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "RENAME_FOLDER":
						try {
							const res = await fetch(`${API}/folders/${msg.folder_id}`, {
								method: "PATCH",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ name: msg.name })
							});
							if (!res.ok) {
								sendResponse({
									success: false,
									error: (await res.json()).detail || "Rename failed"
								});
								break;
							}
							sendResponse({
								success: true,
								folder: await res.json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "DELETE_FOLDER":
						try {
							const res = await fetch(`${API}/folders/${msg.folder_id}`, { method: "DELETE" });
							if (!res.ok) {
								sendResponse({
									success: false,
									error: (await res.json()).detail || "Delete failed"
								});
								break;
							}
							sendResponse({
								success: true,
								...await res.json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "GET_FOLDER_PATH":
						try {
							const res = await fetch(`${API}/folders/${msg.folder_id}/path`);
							if (!res.ok) {
								sendResponse({
									success: false,
									error: "Folder not found"
								});
								break;
							}
							sendResponse({
								success: true,
								...await res.json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
					case "MOVE_BOOKMARK":
						try {
							const res = await fetch(`${API}/bookmark/${msg.bookmark_id}/move`, {
								method: "PATCH",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ folder_id: msg.folder_id || null })
							});
							if (!res.ok) {
								sendResponse({
									success: false,
									error: (await res.json()).detail || "Move failed"
								});
								break;
							}
							sendResponse({
								success: true,
								bookmark: await res.json()
							});
						} catch (e) {
							sendResponse({
								success: false,
								error: e.message
							});
						}
						break;
				}
			})();
			return true;
		});
		async function openItems({ action, groupBy, groups, singleLabel }) {
			const allUrls = groups.flatMap((g) => g.urls);
			if (allUrls.length === 0) return {
				success: true,
				opened: 0
			};
			if (action === "current") {
				for (const url of allUrls) await chrome.tabs.create({
					url,
					active: false
				});
				return {
					success: true,
					opened: allUrls.length
				};
			}
			if (action === "newWindow" || action === "incognito") {
				const win = await chrome.windows.create({
					url: allUrls[0],
					incognito: action === "incognito"
				});
				for (let i = 1; i < allUrls.length; i++) await chrome.tabs.create({
					windowId: win.id,
					url: allUrls[i],
					active: false
				});
				return {
					success: true,
					opened: allUrls.length,
					windowId: win.id
				};
			}
			if (action === "tabGroup") {
				const groupIds = [];
				if (groupBy === "perFolder") for (const g of groups) {
					if (g.urls.length === 0) continue;
					const tabIds = [];
					for (const url of g.urls) {
						const tab = await chrome.tabs.create({
							url,
							active: false
						});
						tabIds.push(tab.id);
					}
					const groupId = await chrome.tabs.group({ tabIds });
					await chrome.tabGroups.update(groupId, { title: g.label });
					groupIds.push(groupId);
				}
				else {
					const tabIds = [];
					for (const url of allUrls) {
						const tab = await chrome.tabs.create({
							url,
							active: false
						});
						tabIds.push(tab.id);
					}
					const groupId = await chrome.tabs.group({ tabIds });
					await chrome.tabGroups.update(groupId, { title: singleLabel || "Opened Bookmarks" });
					groupIds.push(groupId);
				}
				return {
					success: true,
					opened: allUrls.length,
					groupIds
				};
			}
			return {
				success: false,
				error: `Unknown action: ${action}`
			};
		}
	});
	//#endregion
	//#region node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region node_modules/@webext-core/match-patterns/lib/index.js
	var _MatchPattern = class {
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [..._MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		includes(url) {
			if (this.isAllUrls) return true;
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isFileMatch(url) {
			throw Error("Not implemented: file:// pattern matching. Open a PR to add support");
		}
		isFtpMatch(url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var MatchPattern = _MatchPattern;
	MatchPattern.PROTOCOLS = [
		"http",
		"https",
		"file",
		"ftp",
		"urn"
	];
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?/home/rajdeep/Projects/PowerBookmark/powerbookmark-react/src/entrypoints/background.js
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3000";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQubWpzIiwiLi4vLi4vc3JjL2VudHJ5cG9pbnRzL2JhY2tncm91bmQuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHd4dC1kZXYvYnJvd3Nlci9zcmMvaW5kZXgubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L2Jyb3dzZXIubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0B3ZWJleHQtY29yZS9tYXRjaC1wYXR0ZXJucy9saWIvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8jcmVnaW9uIHNyYy91dGlscy9kZWZpbmUtYmFja2dyb3VuZC50c1xuZnVuY3Rpb24gZGVmaW5lQmFja2dyb3VuZChhcmcpIHtcblx0aWYgKGFyZyA9PSBudWxsIHx8IHR5cGVvZiBhcmcgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHsgbWFpbjogYXJnIH07XG5cdHJldHVybiBhcmc7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGRlZmluZUJhY2tncm91bmQgfTtcbiIsImV4cG9ydCBkZWZhdWx0IGRlZmluZUJhY2tncm91bmQoKCkgPT4ge1xuICBjb25zdCBBUEkgPSBcImh0dHA6Ly8xMjcuMC4wLjE6ODc2NVwiO1xuXG4vLyDilIDilIAgQmFkZ2UgaGVscGVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmZ1bmN0aW9uIHNldEJhZGdlKHRhYklkLCBzdGF0ZSkge1xuICBjb25zdCBzdGF0ZXMgPSB7XG4gICAgdW5zYXZlZDogIHsgdGV4dDogXCIrXCIsICBjb2xvcjogXCIjODg4ODg4XCIgfSxcbiAgICBzYXZlZDogICAgeyB0ZXh0OiBcIuKck1wiLCAgY29sb3I6IFwiIzIyYzU1ZVwiIH0sXG4gICAgYXJjaGl2ZWQ6IHsgdGV4dDogXCLwn5OmXCIsIGNvbG9yOiBcIiMzYjgyZjZcIiB9LFxuICAgIGVycm9yOiAgICB7IHRleHQ6IFwiIVwiLCAgY29sb3I6IFwiI2VmNDQ0NFwiIH0sXG4gICAgbG9hZGluZzogIHsgdGV4dDogXCLigKZcIiwgIGNvbG9yOiBcIiNmNTllMGJcIiB9LFxuICB9O1xuICBjb25zdCBzID0gc3RhdGVzW3N0YXRlXSB8fCBzdGF0ZXMudW5zYXZlZDtcbiAgY2hyb21lLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiBzLnRleHQsIHRhYklkIH0pO1xuICBjaHJvbWUuYWN0aW9uLnNldEJhZGdlQmFja2dyb3VuZENvbG9yKHsgY29sb3I6IHMuY29sb3IsIHRhYklkIH0pO1xufVxuXG4vLyDilIDilIAgVVJMIG5vcm1hbGl6YXRpb24gKG1pcnJvcnMgUHl0aG9uIGxvZ2ljKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNvbnN0IFRSQUNLSU5HID0gbmV3IFNldChbXG4gIFwidXRtX3NvdXJjZVwiLFwidXRtX21lZGl1bVwiLFwidXRtX2NhbXBhaWduXCIsXCJ1dG1fdGVybVwiLFwidXRtX2NvbnRlbnRcIixcbiAgXCJmYmNsaWRcIixcImdjbGlkXCIsXCJyZWZcIixcInNvdXJjZVwiLFwibWNfZWlkXCIsXCJtY19jaWRcIlxuXSk7XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVybCh1cmwpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gbmV3IFVSTCh1cmwpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIFsuLi51LnNlYXJjaFBhcmFtcy5rZXlzKCldKSB7XG4gICAgICBpZiAoVFJBQ0tJTkcuaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgdS5zZWFyY2hQYXJhbXMuZGVsZXRlKGtleSk7XG4gICAgfVxuICAgIHUuaGFzaCA9IFwiXCI7XG4gICAgdS5wYXRobmFtZSA9IHUucGF0aG5hbWUucmVwbGFjZSgvXFwvKyQvLCBcIlwiKSB8fCBcIi9cIjtcbiAgICByZXR1cm4gdS50b1N0cmluZygpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdXJsO1xuICB9XG59XG5cbi8vIOKUgOKUgCBMb29rdXAgdGFiIHN0YXRlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuYXN5bmMgZnVuY3Rpb24gbG9va3VwVGFiKHRhYklkLCB1cmwpIHtcbiAgaWYgKCF1cmwgfHwgdXJsLnN0YXJ0c1dpdGgoXCJjaHJvbWU6Ly9cIikgfHwgdXJsLnN0YXJ0c1dpdGgoXCJhYm91dDpcIikpIHtcbiAgICBzZXRCYWRnZSh0YWJJZCwgXCJ1bnNhdmVkXCIpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHNldEJhZGdlKHRhYklkLCBcImxvYWRpbmdcIik7XG4gIHRyeSB7XG4gICAgY29uc3Qgbm9ybSA9IGVuY29kZVVSSUNvbXBvbmVudChub3JtYWxpemVVcmwodXJsKSk7XG4gICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vbG9va3VwP3VybD0ke25vcm19YCk7XG4gICAgaWYgKCFyZXMub2spIHRocm93IG5ldyBFcnJvcihcImxvb2t1cCBmYWlsZWRcIik7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgaWYgKGRhdGEuZXhpc3RzKSB7XG4gICAgICBzZXRCYWRnZSh0YWJJZCwgZGF0YS5hcmNoaXZlZCA/IFwiYXJjaGl2ZWRcIiA6IFwic2F2ZWRcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNldEJhZGdlKHRhYklkLCBcInVuc2F2ZWRcIik7XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9IGNhdGNoIHtcbiAgICBzZXRCYWRnZSh0YWJJZCwgXCJlcnJvclwiKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vLyDilIDilIAgVGFiIGV2ZW50IGxpc3RlbmVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNocm9tZS50YWJzLm9uQWN0aXZhdGVkLmFkZExpc3RlbmVyKGFzeW5jICh7IHRhYklkIH0pID0+IHtcbiAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuZ2V0KHRhYklkKTtcbiAgYXdhaXQgbG9va3VwVGFiKHRhYklkLCB0YWIudXJsKTtcbn0pO1xuXG5jaHJvbWUudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYklkLCBjaGFuZ2UsIHRhYikgPT4ge1xuICBpZiAoY2hhbmdlLnN0YXR1cyA9PT0gXCJjb21wbGV0ZVwiICYmIHRhYi5hY3RpdmUpIHtcbiAgICBhd2FpdCBsb29rdXBUYWIodGFiSWQsIHRhYi51cmwpO1xuICB9XG59KTtcblxuLy8g4pSA4pSAIFNjcmVlbnNob3QgY2FwdHVyZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVTY3JlZW5zaG90KHRhYklkKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZGF0YVVybCA9IGF3YWl0IGNocm9tZS50YWJzLmNhcHR1cmVWaXNpYmxlVGFiKG51bGwsIHtcbiAgICAgIGZvcm1hdDogXCJqcGVnXCIsXG4gICAgICBxdWFsaXR5OiA4NSxcbiAgICB9KTtcbiAgICByZXR1cm4gZGF0YVVybDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJTY3JlZW5zaG90IGZhaWxlZDpcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLy8g4pSA4pSAIEhUTUwgY2FwdHVyZSB2aWEgU2luZ2xlRmlsZSBjb250ZW50IHNjcmlwdCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVIdG1sKHRhYklkKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgY2hyb21lLnNjcmlwdGluZy5leGVjdXRlU2NyaXB0KHtcbiAgICAgIHRhcmdldDogeyB0YWJJZCB9LFxuICAgICAgLy8gSU1QT1JUQU5UOiBVc2UgdGhlIG5ldyBidW5kbGVkIGZpbGUhXG4gICAgICBmaWxlczogW1wic2luZ2xlLWZpbGUtYnVuZGxlZC5qc1wiLCBcImNvbnRlbnQuanNcIl0sIFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKFwiUG93ZXJCb29rbWFyazogc2NyaXB0IGluamVjdGlvbiBmYWlsZWRcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgMTUwKSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNocm9tZS50YWJzLnNlbmRNZXNzYWdlKHRhYklkLCB7IHR5cGU6IFwiR0VUX0hUTUxcIiB9KTtcbiAgICBpZiAoIXJlc3BvbnNlIHx8ICFyZXNwb25zZS5iNjQpIHRocm93IG5ldyBFcnJvcihcIk5vIEhUTUwgcmV0dXJuZWRcIik7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmI2NDsgLy8gUmV0dXJuIHRoZSBiYXNlNjQgc3RyaW5nIGRpcmVjdGx5XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oXCJIVE1MIGNhcHR1cmUgZmFpbGVkIGFmdGVyIGluamVjdGlvbjpcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLy8g4pSA4pSAIE1lc3NhZ2UgaGFuZGxlciAoZnJvbSBwb3B1cCAvIGNvbnRlbnQgc2NyaXB0KSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNocm9tZS5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcigobXNnLCBzZW5kZXIsIHNlbmRSZXNwb25zZSkgPT4ge1xuICAoYXN5bmMgKCkgPT4ge1xuICAgIHN3aXRjaCAobXNnLnR5cGUpIHtcblxuICAgICAgY2FzZSBcIkxPT0tVUFwiOiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGxvb2t1cFRhYihtc2cudGFiSWQsIG1zZy51cmwpO1xuICAgICAgICBzZW5kUmVzcG9uc2UocmVzdWx0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNhc2UgXCJQUk9YWV9GRVRDSFwiOiB7XG4gICAgICAgIGZldGNoKG1zZy51cmwpXG4gICAgICAgICAgLnRoZW4oYXN5bmMgKHJlcykgPT4ge1xuICAgICAgICAgICAgY29uc3QgYmxvYiA9IGF3YWl0IHJlcy5ibG9iKCk7XG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0ge307XG4gICAgICAgICAgICByZXMuaGVhZGVycy5mb3JFYWNoKCh2YWwsIGtleSkgPT4geyBoZWFkZXJzW2tleV0gPSB2YWw7IH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgICAgICAgICAgcmVhZGVyLm9ubG9hZGVuZCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgYmFzZTY0OiByZWFkZXIucmVzdWx0LCBoZWFkZXJzIH0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJlYWRlci5yZWFkQXNEYXRhVVJMKGJsb2IpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrOyAvLyBEb24ndCBmb3JnZXQgdGhlIGJyZWFrIVxuICAgICAgfVxuXG4gICAgICBjYXNlIFwiU0FWRVwiOiB7XG4gICAgICAgIGNvbnN0IHsgdGFiSWQsIHVybCwgdGl0bGUsIHZhdWx0LCB0YWdzLCBhcmNoaXZlLCBub3RlcywgZm9sZGVyX2lkIH0gPSBtc2c7XG5cbiAgICAgICAgbGV0IGZhdmljb25fdXJsID0gXCJcIjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB0YWIgPSBhd2FpdCBjaHJvbWUudGFicy5nZXQodGFiSWQpO1xuICAgICAgICAgIGZhdmljb25fdXJsID0gdGFiLmZhdkljb25VcmwgfHwgXCJcIjtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcIkZhdmljb24gY2FwdHVyZSBmYWlsZWQ6XCIsIGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyZWVuc2hvdERhdGEgPSBhd2FpdCBjYXB0dXJlU2NyZWVuc2hvdCh0YWJJZCk7XG5cbiAgICAgICAgbGV0IGh0bWxEYXRhID0gbnVsbDtcbiAgICAgICAgaWYgKGFyY2hpdmUpIHtcbiAgICAgICAgICBodG1sRGF0YSA9IGF3YWl0IGNhcHR1cmVIdG1sKHRhYklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9zYXZlYCwge1xuICAgICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgdXJsLCB0aXRsZSwgdmF1bHQsIHRhZ3MsIGFyY2hpdmUsXG4gICAgICAgICAgICAgIHNjcmVlbnNob3Q6ICEhc2NyZWVuc2hvdERhdGEsXG4gICAgICAgICAgICAgIG5vdGVzLFxuICAgICAgICAgICAgICBmb2xkZXJfaWQ6IGZvbGRlcl9pZCB8fCBudWxsLFxuICAgICAgICAgICAgICBmYXZpY29uX3VybCxcbiAgICAgICAgICAgICAgc2NyZWVuc2hvdF9kYXRhOiBzY3JlZW5zaG90RGF0YSxcbiAgICAgICAgICAgICAgaHRtbF9kYXRhOiBodG1sRGF0YSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNldEJhZGdlKHRhYklkLCBhcmNoaXZlICYmIGh0bWxEYXRhID8gXCJhcmNoaXZlZFwiIDogXCJzYXZlZFwiKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCAuLi5kYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2V0QmFkZ2UodGFiSWQsIFwiZXJyb3JcIik7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJPUEVOX0lURU1TXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcGVuSXRlbXMoe1xuICAgICAgICAgICAgYWN0aW9uOiBtc2cuYWN0aW9uLFxuICAgICAgICAgICAgZ3JvdXBCeTogbXNnLmdyb3VwQnksXG4gICAgICAgICAgICBncm91cHM6IG1zZy5ncm91cHMsXG4gICAgICAgICAgICBzaW5nbGVMYWJlbDogbXNnLnNpbmdsZUxhYmVsLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHNlbmRSZXNwb25zZShyZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJERUxFVEVcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L2Jvb2ttYXJrLyR7bXNnLmlkfWAsIHsgbWV0aG9kOiBcIkRFTEVURVwiIH0pO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIGNvbnN0IHRhYiAgPSBhd2FpdCBjaHJvbWUudGFicy5nZXQobXNnLnRhYklkKTtcbiAgICAgICAgICBhd2FpdCBsb29rdXBUYWIobXNnLnRhYklkLCB0YWIudXJsKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCAuLi5kYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJTRUFSQ0hcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgICAgIGAke0FQSX0vc2VhcmNoP3E9JHtlbmNvZGVVUklDb21wb25lbnQobXNnLnEpfSR7bXNnLnZhdWx0ID8gXCImdmF1bHQ9XCIgKyBtc2cudmF1bHQgOiBcIlwifWBcbiAgICAgICAgICApO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZShkYXRhKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHJlc3VsdHM6IFtdLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiR0VUX1ZBVUxUU1wiOiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vdmF1bHRzYCk7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKGRhdGEpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgdmF1bHRzOiBbXSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIkdFVF9SRUNFTlRcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L3JlY2VudD9saW1pdD0zMGApO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZShkYXRhKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IGJvb2ttYXJrczogW10sIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJHRVRfQ09OVEVOVFNcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoeyB2YXVsdDogbXNnLnZhdWx0IHx8IFwiZGVmYXVsdFwiIH0pO1xuICAgICAgICAgIGlmIChtc2cuZm9sZGVyX2lkKSBwYXJhbXMuc2V0KFwiZm9sZGVyX2lkXCIsIG1zZy5mb2xkZXJfaWQpO1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L2NvbnRlbnRzPyR7cGFyYW1zfWApO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIC4uLmRhdGEgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIkNSRUFURV9GT0xERVJcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L2ZvbGRlcnNgLCB7XG4gICAgICAgICAgICBtZXRob2Q6ICBcIlBPU1RcIixcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgICAgIGJvZHk6ICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgbmFtZTogICAgICBtc2cubmFtZSxcbiAgICAgICAgICAgICAgcGFyZW50X2lkOiBtc2cucGFyZW50X2lkIHx8IG51bGwsXG4gICAgICAgICAgICAgIHZhdWx0OiAgICAgbXNnLnZhdWx0IHx8IFwiZGVmYXVsdFwiLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5kZXRhaWwgfHwgXCJDcmVhdGUgZmFpbGVkXCIgfSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogdHJ1ZSwgZm9sZGVyOiBkYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJSRU5BTUVfRk9MREVSXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9mb2xkZXJzLyR7bXNnLmZvbGRlcl9pZH1gLCB7XG4gICAgICAgICAgICBtZXRob2Q6ICBcIlBBVENIXCIsXG4gICAgICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgICAgICBib2R5OiAgICBKU09OLnN0cmluZ2lmeSh7IG5hbWU6IG1zZy5uYW1lIH0pLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgICAgICBjb25zdCBlcnIgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIuZGV0YWlsIHx8IFwiUmVuYW1lIGZhaWxlZFwiIH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIGZvbGRlcjogZGF0YSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiREVMRVRFX0ZPTERFUlwiOiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vZm9sZGVycy8ke21zZy5mb2xkZXJfaWR9YCwgeyBtZXRob2Q6IFwiREVMRVRFXCIgfSk7XG4gICAgICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5kZXRhaWwgfHwgXCJEZWxldGUgZmFpbGVkXCIgfSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogdHJ1ZSwgLi4uZGF0YSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiR0VUX0ZPTERFUl9QQVRIXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9mb2xkZXJzLyR7bXNnLmZvbGRlcl9pZH0vcGF0aGApO1xuICAgICAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IFwiRm9sZGVyIG5vdCBmb3VuZFwiIH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIC4uLmRhdGEgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIk1PVkVfQk9PS01BUktcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L2Jvb2ttYXJrLyR7bXNnLmJvb2ttYXJrX2lkfS9tb3ZlYCwge1xuICAgICAgICAgICAgbWV0aG9kOiAgXCJQQVRDSFwiLFxuICAgICAgICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICAgICAgYm9keTogICAgSlNPTi5zdHJpbmdpZnkoeyBmb2xkZXJfaWQ6IG1zZy5mb2xkZXJfaWQgfHwgbnVsbCB9KSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAoIXJlcy5vaykge1xuICAgICAgICAgICAgY29uc3QgZXJyID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLmRldGFpbCB8fCBcIk1vdmUgZmFpbGVkXCIgfSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogdHJ1ZSwgYm9va21hcms6IGRhdGEgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgIH1cbiAgfSkoKTtcbiAgcmV0dXJuIHRydWU7XG59KTtcblxuXG4vLyDilIDilIAgQnVsayBvcGVuIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuYXN5bmMgZnVuY3Rpb24gb3Blbkl0ZW1zKHsgYWN0aW9uLCBncm91cEJ5LCBncm91cHMsIHNpbmdsZUxhYmVsIH0pIHtcbiAgY29uc3QgYWxsVXJscyA9IGdyb3Vwcy5mbGF0TWFwKGcgPT4gZy51cmxzKTtcbiAgaWYgKGFsbFVybHMubGVuZ3RoID09PSAwKSByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBvcGVuZWQ6IDAgfTtcblxuICBpZiAoYWN0aW9uID09PSBcImN1cnJlbnRcIikge1xuICAgIGZvciAoY29uc3QgdXJsIG9mIGFsbFVybHMpIHtcbiAgICAgIGF3YWl0IGNocm9tZS50YWJzLmNyZWF0ZSh7IHVybCwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgb3BlbmVkOiBhbGxVcmxzLmxlbmd0aCB9O1xuICB9XG5cbiAgaWYgKGFjdGlvbiA9PT0gXCJuZXdXaW5kb3dcIiB8fCBhY3Rpb24gPT09IFwiaW5jb2duaXRvXCIpIHtcbiAgICBjb25zdCB3aW4gPSBhd2FpdCBjaHJvbWUud2luZG93cy5jcmVhdGUoe1xuICAgICAgdXJsOiBhbGxVcmxzWzBdLFxuICAgICAgaW5jb2duaXRvOiBhY3Rpb24gPT09IFwiaW5jb2duaXRvXCIsXG4gICAgfSk7XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBhbGxVcmxzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBhd2FpdCBjaHJvbWUudGFicy5jcmVhdGUoeyB3aW5kb3dJZDogd2luLmlkLCB1cmw6IGFsbFVybHNbaV0sIGFjdGl2ZTogZmFsc2UgfSk7XG4gICAgfVxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG9wZW5lZDogYWxsVXJscy5sZW5ndGgsIHdpbmRvd0lkOiB3aW4uaWQgfTtcbiAgfVxuXG4gIGlmIChhY3Rpb24gPT09IFwidGFiR3JvdXBcIikge1xuICAgIGNvbnN0IGdyb3VwSWRzID0gW107XG5cbiAgICBpZiAoZ3JvdXBCeSA9PT0gXCJwZXJGb2xkZXJcIikge1xuICAgICAgLy8gT25lIHRhYiBncm91cCBwZXIgZm9sZGVyL3NvdXJjZSwgZWFjaCBuYW1lZCBhZnRlciBpdHMgbGFiZWxcbiAgICAgIGZvciAoY29uc3QgZyBvZiBncm91cHMpIHtcbiAgICAgICAgaWYgKGcudXJscy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0YWJJZHMgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCB1cmwgb2YgZy51cmxzKSB7XG4gICAgICAgICAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuY3JlYXRlKHsgdXJsLCBhY3RpdmU6IGZhbHNlIH0pO1xuICAgICAgICAgIHRhYklkcy5wdXNoKHRhYi5pZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IGNocm9tZS50YWJzLmdyb3VwKHsgdGFiSWRzIH0pO1xuICAgICAgICBhd2FpdCBjaHJvbWUudGFiR3JvdXBzLnVwZGF0ZShncm91cElkLCB7IHRpdGxlOiBnLmxhYmVsIH0pO1xuICAgICAgICBncm91cElkcy5wdXNoKGdyb3VwSWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTaW5nbGUgY29tYmluZWQgZ3JvdXAgKG1hdGNoZXMgQ2hyb21lJ3MgbmF0aXZlIGJvb2ttYXJrIG1hbmFnZXIgYmVoYXZpb3IpXG4gICAgICBjb25zdCB0YWJJZHMgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgdXJsIG9mIGFsbFVybHMpIHtcbiAgICAgICAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuY3JlYXRlKHsgdXJsLCBhY3RpdmU6IGZhbHNlIH0pO1xuICAgICAgICB0YWJJZHMucHVzaCh0YWIuaWQpO1xuICAgICAgfVxuICAgICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IGNocm9tZS50YWJzLmdyb3VwKHsgdGFiSWRzIH0pO1xuICAgICAgYXdhaXQgY2hyb21lLnRhYkdyb3Vwcy51cGRhdGUoZ3JvdXBJZCwgeyB0aXRsZTogc2luZ2xlTGFiZWwgfHwgXCJPcGVuZWQgQm9va21hcmtzXCIgfSk7XG4gICAgICBncm91cElkcy5wdXNoKGdyb3VwSWQpO1xuICAgIH1cblxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG9wZW5lZDogYWxsVXJscy5sZW5ndGgsIGdyb3VwSWRzIH07XG4gIH1cblxuICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBVbmtub3duIGFjdGlvbjogJHthY3Rpb259YCB9O1xufVxuXG5cblxuXG59KTsiLCIvLyAjcmVnaW9uIHNuaXBwZXRcbmV4cG9ydCBjb25zdCBicm93c2VyID0gZ2xvYmFsVGhpcy5icm93c2VyPy5ydW50aW1lPy5pZFxuICA/IGdsb2JhbFRoaXMuYnJvd3NlclxuICA6IGdsb2JhbFRoaXMuY2hyb21lO1xuLy8gI2VuZHJlZ2lvbiBzbmlwcGV0XG4iLCJpbXBvcnQgeyBicm93c2VyIGFzIGJyb3dzZXIkMSB9IGZyb20gXCJAd3h0LWRldi9icm93c2VyXCI7XG4vLyNyZWdpb24gc3JjL2Jyb3dzZXIudHNcbi8qKlxuKiBDb250YWlucyB0aGUgYGJyb3dzZXJgIGV4cG9ydCB3aGljaCB5b3Ugc2hvdWxkIHVzZSB0byBhY2Nlc3MgdGhlIGV4dGVuc2lvblxuKiBBUElzIGluIHlvdXIgcHJvamVjdDpcbipcbiogYGBgdHNcbiogaW1wb3J0IHsgYnJvd3NlciB9IGZyb20gJ3d4dC9icm93c2VyJztcbipcbiogYnJvd3Nlci5ydW50aW1lLm9uSW5zdGFsbGVkLmFkZExpc3RlbmVyKCgpID0+IHtcbiogICAvLyAuLi5cbiogfSk7XG4qIGBgYFxuKlxuKiBAbW9kdWxlIHd4dC9icm93c2VyXG4qL1xuY29uc3QgYnJvd3NlciA9IGJyb3dzZXIkMTtcbi8vI2VuZHJlZ2lvblxuZXhwb3J0IHsgYnJvd3NlciB9O1xuIiwiLy8gc3JjL2luZGV4LnRzXG52YXIgX01hdGNoUGF0dGVybiA9IGNsYXNzIHtcbiAgY29uc3RydWN0b3IobWF0Y2hQYXR0ZXJuKSB7XG4gICAgaWYgKG1hdGNoUGF0dGVybiA9PT0gXCI8YWxsX3VybHM+XCIpIHtcbiAgICAgIHRoaXMuaXNBbGxVcmxzID0gdHJ1ZTtcbiAgICAgIHRoaXMucHJvdG9jb2xNYXRjaGVzID0gWy4uLl9NYXRjaFBhdHRlcm4uUFJPVE9DT0xTXTtcbiAgICAgIHRoaXMuaG9zdG5hbWVNYXRjaCA9IFwiKlwiO1xuICAgICAgdGhpcy5wYXRobmFtZU1hdGNoID0gXCIqXCI7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IC8oLiopOlxcL1xcLyguKj8pKFxcLy4qKS8uZXhlYyhtYXRjaFBhdHRlcm4pO1xuICAgICAgaWYgKGdyb3VwcyA9PSBudWxsKVxuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIFwiSW5jb3JyZWN0IGZvcm1hdFwiKTtcbiAgICAgIGNvbnN0IFtfLCBwcm90b2NvbCwgaG9zdG5hbWUsIHBhdGhuYW1lXSA9IGdyb3VwcztcbiAgICAgIHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCk7XG4gICAgICB2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpO1xuICAgICAgdmFsaWRhdGVQYXRobmFtZShtYXRjaFBhdHRlcm4sIHBhdGhuYW1lKTtcbiAgICAgIHRoaXMucHJvdG9jb2xNYXRjaGVzID0gcHJvdG9jb2wgPT09IFwiKlwiID8gW1wiaHR0cFwiLCBcImh0dHBzXCJdIDogW3Byb3RvY29sXTtcbiAgICAgIHRoaXMuaG9zdG5hbWVNYXRjaCA9IGhvc3RuYW1lO1xuICAgICAgdGhpcy5wYXRobmFtZU1hdGNoID0gcGF0aG5hbWU7XG4gICAgfVxuICB9XG4gIGluY2x1ZGVzKHVybCkge1xuICAgIGlmICh0aGlzLmlzQWxsVXJscylcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHUgPSB0eXBlb2YgdXJsID09PSBcInN0cmluZ1wiID8gbmV3IFVSTCh1cmwpIDogdXJsIGluc3RhbmNlb2YgTG9jYXRpb24gPyBuZXcgVVJMKHVybC5ocmVmKSA6IHVybDtcbiAgICByZXR1cm4gISF0aGlzLnByb3RvY29sTWF0Y2hlcy5maW5kKChwcm90b2NvbCkgPT4ge1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImh0dHBcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNIdHRwTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiaHR0cHNcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNIdHRwc01hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImZpbGVcIilcbiAgICAgICAgcmV0dXJuIHRoaXMuaXNGaWxlTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwiZnRwXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzRnRwTWF0Y2godSk7XG4gICAgICBpZiAocHJvdG9jb2wgPT09IFwidXJuXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzVXJuTWF0Y2godSk7XG4gICAgfSk7XG4gIH1cbiAgaXNIdHRwTWF0Y2godXJsKSB7XG4gICAgcmV0dXJuIHVybC5wcm90b2NvbCA9PT0gXCJodHRwOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG4gIH1cbiAgaXNIdHRwc01hdGNoKHVybCkge1xuICAgIHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cHM6XCIgJiYgdGhpcy5pc0hvc3RQYXRoTWF0Y2godXJsKTtcbiAgfVxuICBpc0hvc3RQYXRoTWF0Y2godXJsKSB7XG4gICAgaWYgKCF0aGlzLmhvc3RuYW1lTWF0Y2ggfHwgIXRoaXMucGF0aG5hbWVNYXRjaClcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBob3N0bmFtZU1hdGNoUmVnZXhzID0gW1xuICAgICAgdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5ob3N0bmFtZU1hdGNoKSxcbiAgICAgIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaC5yZXBsYWNlKC9eXFwqXFwuLywgXCJcIikpXG4gICAgXTtcbiAgICBjb25zdCBwYXRobmFtZU1hdGNoUmVnZXggPSB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLnBhdGhuYW1lTWF0Y2gpO1xuICAgIHJldHVybiAhIWhvc3RuYW1lTWF0Y2hSZWdleHMuZmluZCgocmVnZXgpID0+IHJlZ2V4LnRlc3QodXJsLmhvc3RuYW1lKSkgJiYgcGF0aG5hbWVNYXRjaFJlZ2V4LnRlc3QodXJsLnBhdGhuYW1lKTtcbiAgfVxuICBpc0ZpbGVNYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogZmlsZTovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG4gIH1cbiAgaXNGdHBNYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogZnRwOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcbiAgfVxuICBpc1Vybk1hdGNoKHVybCkge1xuICAgIHRocm93IEVycm9yKFwiTm90IGltcGxlbWVudGVkOiB1cm46Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuICB9XG4gIGNvbnZlcnRQYXR0ZXJuVG9SZWdleChwYXR0ZXJuKSB7XG4gICAgY29uc3QgZXNjYXBlZCA9IHRoaXMuZXNjYXBlRm9yUmVnZXgocGF0dGVybik7XG4gICAgY29uc3Qgc3RhcnNSZXBsYWNlZCA9IGVzY2FwZWQucmVwbGFjZSgvXFxcXFxcKi9nLCBcIi4qXCIpO1xuICAgIHJldHVybiBSZWdFeHAoYF4ke3N0YXJzUmVwbGFjZWR9JGApO1xuICB9XG4gIGVzY2FwZUZvclJlZ2V4KHN0cmluZykge1xuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xuICB9XG59O1xudmFyIE1hdGNoUGF0dGVybiA9IF9NYXRjaFBhdHRlcm47XG5NYXRjaFBhdHRlcm4uUFJPVE9DT0xTID0gW1wiaHR0cFwiLCBcImh0dHBzXCIsIFwiZmlsZVwiLCBcImZ0cFwiLCBcInVyblwiXTtcbnZhciBJbnZhbGlkTWF0Y2hQYXR0ZXJuID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybiwgcmVhc29uKSB7XG4gICAgc3VwZXIoYEludmFsaWQgbWF0Y2ggcGF0dGVybiBcIiR7bWF0Y2hQYXR0ZXJufVwiOiAke3JlYXNvbn1gKTtcbiAgfVxufTtcbmZ1bmN0aW9uIHZhbGlkYXRlUHJvdG9jb2wobWF0Y2hQYXR0ZXJuLCBwcm90b2NvbCkge1xuICBpZiAoIU1hdGNoUGF0dGVybi5QUk9UT0NPTFMuaW5jbHVkZXMocHJvdG9jb2wpICYmIHByb3RvY29sICE9PSBcIipcIilcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihcbiAgICAgIG1hdGNoUGF0dGVybixcbiAgICAgIGAke3Byb3RvY29sfSBub3QgYSB2YWxpZCBwcm90b2NvbCAoJHtNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmpvaW4oXCIsIFwiKX0pYFxuICAgICk7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZUhvc3RuYW1lKG1hdGNoUGF0dGVybiwgaG9zdG5hbWUpIHtcbiAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiOlwiKSlcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1hdGNoUGF0dGVybihtYXRjaFBhdHRlcm4sIGBIb3N0bmFtZSBjYW5ub3QgaW5jbHVkZSBhIHBvcnRgKTtcbiAgaWYgKGhvc3RuYW1lLmluY2x1ZGVzKFwiKlwiKSAmJiBob3N0bmFtZS5sZW5ndGggPiAxICYmICFob3N0bmFtZS5zdGFydHNXaXRoKFwiKi5cIikpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4oXG4gICAgICBtYXRjaFBhdHRlcm4sXG4gICAgICBgSWYgdXNpbmcgYSB3aWxkY2FyZCAoKiksIGl0IG11c3QgZ28gYXQgdGhlIHN0YXJ0IG9mIHRoZSBob3N0bmFtZWBcbiAgICApO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVQYXRobmFtZShtYXRjaFBhdHRlcm4sIHBhdGhuYW1lKSB7XG4gIHJldHVybjtcbn1cbmV4cG9ydCB7XG4gIEludmFsaWRNYXRjaFBhdHRlcm4sXG4gIE1hdGNoUGF0dGVyblxufTtcbiJdLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMCwyLDMsNF0sIm1hcHBpbmdzIjoiOztDQUNBLFNBQVMsaUJBQWlCLEtBQUs7RUFDOUIsSUFBSSxPQUFPLFFBQVEsT0FBTyxRQUFRLFlBQVksT0FBTyxFQUFFLE1BQU0sSUFBSTtFQUNqRSxPQUFPO0NBQ1I7OztDQ0pBLElBQUEscUJBQUEsdUJBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7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