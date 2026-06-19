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
					case "SAVE_ALL_TABS": {
						const { vault, folder_id, tags, originalTabId, captureScreenshots, tabIds } = msg;
						const validTabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id)))).filter((t) => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("about:"));
						const results = [];
						for (const tab of validTabs) {
							let screenshotData = null;
							if (captureScreenshots) {
								await chrome.tabs.update(tab.id, { active: true });
								await new Promise((resolve) => {
									const checkAndWait = async () => {
										if ((await chrome.tabs.get(tab.id)).status === "complete") {
											setTimeout(resolve, 300);
											return;
										}
										const timeout = setTimeout(resolve, 5e3);
										const listener = (tabId, changeInfo) => {
											if (tabId === tab.id && changeInfo.status === "complete") {
												clearTimeout(timeout);
												chrome.tabs.onUpdated.removeListener(listener);
												setTimeout(resolve, 300);
											}
										};
										chrome.tabs.onUpdated.addListener(listener);
									};
									checkAndWait();
								});
								screenshotData = await captureScreenshot(tab.id);
							}
							try {
								const data = await (await fetch(`${API}/save`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										url: tab.url,
										title: tab.title || "",
										vault,
										tags: tags || [],
										archive: false,
										screenshot: !!screenshotData,
										notes: "",
										folder_id: folder_id || null,
										favicon_url: tab.favIconUrl || "",
										screenshot_data: screenshotData,
										html_data: null
									})
								})).json();
								results.push({
									success: true,
									url: tab.url,
									id: data.id
								});
							} catch (e) {
								results.push({
									success: false,
									url: tab.url,
									error: e.message
								});
							}
						}
						if (captureScreenshots && originalTabId) await chrome.tabs.update(originalTabId, { active: true });
						sendResponse({
							success: true,
							results,
							total: results.length
						});
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQubWpzIiwiLi4vLi4vc3JjL2VudHJ5cG9pbnRzL2JhY2tncm91bmQuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHd4dC1kZXYvYnJvd3Nlci9zcmMvaW5kZXgubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L2Jyb3dzZXIubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0B3ZWJleHQtY29yZS9tYXRjaC1wYXR0ZXJucy9saWIvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8jcmVnaW9uIHNyYy91dGlscy9kZWZpbmUtYmFja2dyb3VuZC50c1xuZnVuY3Rpb24gZGVmaW5lQmFja2dyb3VuZChhcmcpIHtcblx0aWYgKGFyZyA9PSBudWxsIHx8IHR5cGVvZiBhcmcgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHsgbWFpbjogYXJnIH07XG5cdHJldHVybiBhcmc7XG59XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGRlZmluZUJhY2tncm91bmQgfTtcbiIsImV4cG9ydCBkZWZhdWx0IGRlZmluZUJhY2tncm91bmQoKCkgPT4ge1xuICBjb25zdCBBUEkgPSBcImh0dHA6Ly8xMjcuMC4wLjE6ODc2NVwiO1xuXG4vLyDilIDilIAgQmFkZ2UgaGVscGVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmZ1bmN0aW9uIHNldEJhZGdlKHRhYklkLCBzdGF0ZSkge1xuICBjb25zdCBzdGF0ZXMgPSB7XG4gICAgdW5zYXZlZDogIHsgdGV4dDogXCIrXCIsICBjb2xvcjogXCIjODg4ODg4XCIgfSxcbiAgICBzYXZlZDogICAgeyB0ZXh0OiBcIuKck1wiLCAgY29sb3I6IFwiIzIyYzU1ZVwiIH0sXG4gICAgYXJjaGl2ZWQ6IHsgdGV4dDogXCLwn5OmXCIsIGNvbG9yOiBcIiMzYjgyZjZcIiB9LFxuICAgIGVycm9yOiAgICB7IHRleHQ6IFwiIVwiLCAgY29sb3I6IFwiI2VmNDQ0NFwiIH0sXG4gICAgbG9hZGluZzogIHsgdGV4dDogXCLigKZcIiwgIGNvbG9yOiBcIiNmNTllMGJcIiB9LFxuICB9O1xuICBjb25zdCBzID0gc3RhdGVzW3N0YXRlXSB8fCBzdGF0ZXMudW5zYXZlZDtcbiAgY2hyb21lLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiBzLnRleHQsIHRhYklkIH0pO1xuICBjaHJvbWUuYWN0aW9uLnNldEJhZGdlQmFja2dyb3VuZENvbG9yKHsgY29sb3I6IHMuY29sb3IsIHRhYklkIH0pO1xufVxuXG4vLyDilIDilIAgVVJMIG5vcm1hbGl6YXRpb24gKG1pcnJvcnMgUHl0aG9uIGxvZ2ljKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNvbnN0IFRSQUNLSU5HID0gbmV3IFNldChbXG4gIFwidXRtX3NvdXJjZVwiLFwidXRtX21lZGl1bVwiLFwidXRtX2NhbXBhaWduXCIsXCJ1dG1fdGVybVwiLFwidXRtX2NvbnRlbnRcIixcbiAgXCJmYmNsaWRcIixcImdjbGlkXCIsXCJyZWZcIixcInNvdXJjZVwiLFwibWNfZWlkXCIsXCJtY19jaWRcIlxuXSk7XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVVybCh1cmwpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1ID0gbmV3IFVSTCh1cmwpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIFsuLi51LnNlYXJjaFBhcmFtcy5rZXlzKCldKSB7XG4gICAgICBpZiAoVFJBQ0tJTkcuaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgdS5zZWFyY2hQYXJhbXMuZGVsZXRlKGtleSk7XG4gICAgfVxuICAgIHUuaGFzaCA9IFwiXCI7XG4gICAgdS5wYXRobmFtZSA9IHUucGF0aG5hbWUucmVwbGFjZSgvXFwvKyQvLCBcIlwiKSB8fCBcIi9cIjtcbiAgICByZXR1cm4gdS50b1N0cmluZygpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdXJsO1xuICB9XG59XG5cbi8vIOKUgOKUgCBMb29rdXAgdGFiIHN0YXRlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuYXN5bmMgZnVuY3Rpb24gbG9va3VwVGFiKHRhYklkLCB1cmwpIHtcbiAgaWYgKCF1cmwgfHwgdXJsLnN0YXJ0c1dpdGgoXCJjaHJvbWU6Ly9cIikgfHwgdXJsLnN0YXJ0c1dpdGgoXCJhYm91dDpcIikpIHtcbiAgICBzZXRCYWRnZSh0YWJJZCwgXCJ1bnNhdmVkXCIpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHNldEJhZGdlKHRhYklkLCBcImxvYWRpbmdcIik7XG4gIHRyeSB7XG4gICAgY29uc3Qgbm9ybSA9IGVuY29kZVVSSUNvbXBvbmVudChub3JtYWxpemVVcmwodXJsKSk7XG4gICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vbG9va3VwP3VybD0ke25vcm19YCk7XG4gICAgaWYgKCFyZXMub2spIHRocm93IG5ldyBFcnJvcihcImxvb2t1cCBmYWlsZWRcIik7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgaWYgKGRhdGEuZXhpc3RzKSB7XG4gICAgICBzZXRCYWRnZSh0YWJJZCwgZGF0YS5hcmNoaXZlZCA/IFwiYXJjaGl2ZWRcIiA6IFwic2F2ZWRcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNldEJhZGdlKHRhYklkLCBcInVuc2F2ZWRcIik7XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9IGNhdGNoIHtcbiAgICBzZXRCYWRnZSh0YWJJZCwgXCJlcnJvclwiKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vLyDilIDilIAgVGFiIGV2ZW50IGxpc3RlbmVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNocm9tZS50YWJzLm9uQWN0aXZhdGVkLmFkZExpc3RlbmVyKGFzeW5jICh7IHRhYklkIH0pID0+IHtcbiAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuZ2V0KHRhYklkKTtcbiAgYXdhaXQgbG9va3VwVGFiKHRhYklkLCB0YWIudXJsKTtcbn0pO1xuXG5jaHJvbWUudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIoYXN5bmMgKHRhYklkLCBjaGFuZ2UsIHRhYikgPT4ge1xuICBpZiAoY2hhbmdlLnN0YXR1cyA9PT0gXCJjb21wbGV0ZVwiICYmIHRhYi5hY3RpdmUpIHtcbiAgICBhd2FpdCBsb29rdXBUYWIodGFiSWQsIHRhYi51cmwpO1xuICB9XG59KTtcblxuLy8g4pSA4pSAIFNjcmVlbnNob3QgY2FwdHVyZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVTY3JlZW5zaG90KHRhYklkKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZGF0YVVybCA9IGF3YWl0IGNocm9tZS50YWJzLmNhcHR1cmVWaXNpYmxlVGFiKG51bGwsIHtcbiAgICAgIGZvcm1hdDogXCJqcGVnXCIsXG4gICAgICBxdWFsaXR5OiA4NSxcbiAgICB9KTtcbiAgICByZXR1cm4gZGF0YVVybDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJTY3JlZW5zaG90IGZhaWxlZDpcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLy8g4pSA4pSAIEhUTUwgY2FwdHVyZSB2aWEgU2luZ2xlRmlsZSBjb250ZW50IHNjcmlwdCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVIdG1sKHRhYklkKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgY2hyb21lLnNjcmlwdGluZy5leGVjdXRlU2NyaXB0KHtcbiAgICAgIHRhcmdldDogeyB0YWJJZCB9LFxuICAgICAgLy8gSU1QT1JUQU5UOiBVc2UgdGhlIG5ldyBidW5kbGVkIGZpbGUhXG4gICAgICBmaWxlczogW1wic2luZ2xlLWZpbGUtYnVuZGxlZC5qc1wiLCBcImNvbnRlbnQuanNcIl0sIFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKFwiUG93ZXJCb29rbWFyazogc2NyaXB0IGluamVjdGlvbiBmYWlsZWRcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgMTUwKSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNocm9tZS50YWJzLnNlbmRNZXNzYWdlKHRhYklkLCB7IHR5cGU6IFwiR0VUX0hUTUxcIiB9KTtcbiAgICBpZiAoIXJlc3BvbnNlIHx8ICFyZXNwb25zZS5iNjQpIHRocm93IG5ldyBFcnJvcihcIk5vIEhUTUwgcmV0dXJuZWRcIik7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmI2NDsgLy8gUmV0dXJuIHRoZSBiYXNlNjQgc3RyaW5nIGRpcmVjdGx5XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oXCJIVE1MIGNhcHR1cmUgZmFpbGVkIGFmdGVyIGluamVjdGlvbjpcIiwgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLy8g4pSA4pSAIE1lc3NhZ2UgaGFuZGxlciAoZnJvbSBwb3B1cCAvIGNvbnRlbnQgc2NyaXB0KSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNocm9tZS5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcigobXNnLCBzZW5kZXIsIHNlbmRSZXNwb25zZSkgPT4ge1xuICAoYXN5bmMgKCkgPT4ge1xuICAgIHN3aXRjaCAobXNnLnR5cGUpIHtcblxuICAgICAgY2FzZSBcIkxPT0tVUFwiOiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGxvb2t1cFRhYihtc2cudGFiSWQsIG1zZy51cmwpO1xuICAgICAgICBzZW5kUmVzcG9uc2UocmVzdWx0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNhc2UgXCJQUk9YWV9GRVRDSFwiOiB7XG4gICAgICAgIGZldGNoKG1zZy51cmwpXG4gICAgICAgICAgLnRoZW4oYXN5bmMgKHJlcykgPT4ge1xuICAgICAgICAgICAgY29uc3QgYmxvYiA9IGF3YWl0IHJlcy5ibG9iKCk7XG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0ge307XG4gICAgICAgICAgICByZXMuaGVhZGVycy5mb3JFYWNoKCh2YWwsIGtleSkgPT4geyBoZWFkZXJzW2tleV0gPSB2YWw7IH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgICAgICAgICAgcmVhZGVyLm9ubG9hZGVuZCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgYmFzZTY0OiByZWFkZXIucmVzdWx0LCBoZWFkZXJzIH0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHJlYWRlci5yZWFkQXNEYXRhVVJMKGJsb2IpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrOyAvLyBEb24ndCBmb3JnZXQgdGhlIGJyZWFrIVxuICAgICAgfVxuXG4gICAgICBjYXNlIFwiU0FWRVwiOiB7XG4gICAgICAgIGNvbnN0IHsgdGFiSWQsIHVybCwgdGl0bGUsIHZhdWx0LCB0YWdzLCBhcmNoaXZlLCBub3RlcywgZm9sZGVyX2lkIH0gPSBtc2c7XG5cbiAgICAgICAgbGV0IGZhdmljb25fdXJsID0gXCJcIjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB0YWIgPSBhd2FpdCBjaHJvbWUudGFicy5nZXQodGFiSWQpO1xuICAgICAgICAgIGZhdmljb25fdXJsID0gdGFiLmZhdkljb25VcmwgfHwgXCJcIjtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcIkZhdmljb24gY2FwdHVyZSBmYWlsZWQ6XCIsIGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NyZWVuc2hvdERhdGEgPSBhd2FpdCBjYXB0dXJlU2NyZWVuc2hvdCh0YWJJZCk7XG5cbiAgICAgICAgbGV0IGh0bWxEYXRhID0gbnVsbDtcbiAgICAgICAgaWYgKGFyY2hpdmUpIHtcbiAgICAgICAgICBodG1sRGF0YSA9IGF3YWl0IGNhcHR1cmVIdG1sKHRhYklkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9zYXZlYCwge1xuICAgICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgdXJsLCB0aXRsZSwgdmF1bHQsIHRhZ3MsIGFyY2hpdmUsXG4gICAgICAgICAgICAgIHNjcmVlbnNob3Q6ICEhc2NyZWVuc2hvdERhdGEsXG4gICAgICAgICAgICAgIG5vdGVzLFxuICAgICAgICAgICAgICBmb2xkZXJfaWQ6IGZvbGRlcl9pZCB8fCBudWxsLFxuICAgICAgICAgICAgICBmYXZpY29uX3VybCxcbiAgICAgICAgICAgICAgc2NyZWVuc2hvdF9kYXRhOiBzY3JlZW5zaG90RGF0YSxcbiAgICAgICAgICAgICAgaHRtbF9kYXRhOiBodG1sRGF0YSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNldEJhZGdlKHRhYklkLCBhcmNoaXZlICYmIGh0bWxEYXRhID8gXCJhcmNoaXZlZFwiIDogXCJzYXZlZFwiKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCAuLi5kYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2V0QmFkZ2UodGFiSWQsIFwiZXJyb3JcIik7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNhc2UgXCJTQVZFX0FMTF9UQUJTXCI6IHtcbiAgICBjb25zdCB7IHZhdWx0LCBmb2xkZXJfaWQsIHRhZ3MsIG9yaWdpbmFsVGFiSWQsIGNhcHR1cmVTY3JlZW5zaG90cywgdGFiSWRzIH0gPSBtc2c7XG5cbiAgICAvLyBHZXQgb25seSB0aGUgdGFicyB3ZSB3ZXJlIHRvbGQgdG8gc2F2ZVxuICAgIGNvbnN0IHRhYnMgPSBhd2FpdCBQcm9taXNlLmFsbCh0YWJJZHMubWFwKGlkID0+IGNocm9tZS50YWJzLmdldChpZCkpKTtcbiAgICBjb25zdCB2YWxpZFRhYnMgPSB0YWJzLmZpbHRlcih0ID0+XG4gICAgICAgIHQudXJsICYmICF0LnVybC5zdGFydHNXaXRoKCdjaHJvbWU6Ly8nKSAmJiAhdC51cmwuc3RhcnRzV2l0aCgnYWJvdXQ6JylcbiAgICApO1xuXG4gICAgY29uc3QgcmVzdWx0cyA9IFtdO1xuXG4gICAgZm9yIChjb25zdCB0YWIgb2YgdmFsaWRUYWJzKSB7XG4gICAgICAgIGxldCBzY3JlZW5zaG90RGF0YSA9IG51bGw7XG5cbiAgICAgICAgaWYgKGNhcHR1cmVTY3JlZW5zaG90cykge1xuICAgICAgICAgICAgYXdhaXQgY2hyb21lLnRhYnMudXBkYXRlKHRhYi5pZCwgeyBhY3RpdmU6IHRydWUgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNoZWNrQW5kV2FpdCA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnJlc2hUYWIgPSBhd2FpdCBjaHJvbWUudGFicy5nZXQodGFiLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZyZXNoVGFiLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCAzMDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KHJlc29sdmUsIDUwMDApO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaXN0ZW5lciA9ICh0YWJJZCwgY2hhbmdlSW5mbykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRhYklkID09PSB0YWIuaWQgJiYgY2hhbmdlSW5mby5zdGF0dXMgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hyb21lLnRhYnMub25VcGRhdGVkLnJlbW92ZUxpc3RlbmVyKGxpc3RlbmVyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGNocm9tZS50YWJzLm9uVXBkYXRlZC5hZGRMaXN0ZW5lcihsaXN0ZW5lcik7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBjaGVja0FuZFdhaXQoKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBzY3JlZW5zaG90RGF0YSA9IGF3YWl0IGNhcHR1cmVTY3JlZW5zaG90KHRhYi5pZCk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9zYXZlYCwge1xuICAgICAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAgICAgdXJsOiB0YWIudXJsLFxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogdGFiLnRpdGxlIHx8ICcnLFxuICAgICAgICAgICAgICAgICAgICB2YXVsdCxcbiAgICAgICAgICAgICAgICAgICAgdGFnczogdGFncyB8fCBbXSxcbiAgICAgICAgICAgICAgICAgICAgYXJjaGl2ZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNjcmVlbnNob3Q6ICEhc2NyZWVuc2hvdERhdGEsXG4gICAgICAgICAgICAgICAgICAgIG5vdGVzOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgZm9sZGVyX2lkOiBmb2xkZXJfaWQgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZmF2aWNvbl91cmw6IHRhYi5mYXZJY29uVXJsIHx8ICcnLFxuICAgICAgICAgICAgICAgICAgICBzY3JlZW5zaG90X2RhdGE6IHNjcmVlbnNob3REYXRhLFxuICAgICAgICAgICAgICAgICAgICBodG1sX2RhdGE6IG51bGwsXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHsgc3VjY2VzczogdHJ1ZSwgdXJsOiB0YWIudXJsLCBpZDogZGF0YS5pZCB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHsgc3VjY2VzczogZmFsc2UsIHVybDogdGFiLnVybCwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjYXB0dXJlU2NyZWVuc2hvdHMgJiYgb3JpZ2luYWxUYWJJZCkge1xuICAgICAgICBhd2FpdCBjaHJvbWUudGFicy51cGRhdGUob3JpZ2luYWxUYWJJZCwgeyBhY3RpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogdHJ1ZSwgcmVzdWx0cywgdG90YWw6IHJlc3VsdHMubGVuZ3RoIH0pO1xuICAgIGJyZWFrO1xufVxuXG4gICAgICBjYXNlIFwiT1BFTl9JVEVNU1wiOiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3Blbkl0ZW1zKHtcbiAgICAgICAgICAgIGFjdGlvbjogbXNnLmFjdGlvbixcbiAgICAgICAgICAgIGdyb3VwQnk6IG1zZy5ncm91cEJ5LFxuICAgICAgICAgICAgZ3JvdXBzOiBtc2cuZ3JvdXBzLFxuICAgICAgICAgICAgc2luZ2xlTGFiZWw6IG1zZy5zaW5nbGVMYWJlbCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UocmVzdWx0KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiREVMRVRFXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9ib29rbWFyay8ke21zZy5pZH1gLCB7IG1ldGhvZDogXCJERUxFVEVcIiB9KTtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBjb25zdCB0YWIgID0gYXdhaXQgY2hyb21lLnRhYnMuZ2V0KG1zZy50YWJJZCk7XG4gICAgICAgICAgYXdhaXQgbG9va3VwVGFiKG1zZy50YWJJZCwgdGFiLnVybCk7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogdHJ1ZSwgLi4uZGF0YSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiU0VBUkNIXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goXG4gICAgICAgICAgICBgJHtBUEl9L3NlYXJjaD9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KG1zZy5xKX0ke21zZy52YXVsdCA/IFwiJnZhdWx0PVwiICsgbXNnLnZhdWx0IDogXCJcIn1gXG4gICAgICAgICAgKTtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoZGF0YSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyByZXN1bHRzOiBbXSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIkdFVF9WQVVMVFNcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L3ZhdWx0c2ApO1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZShkYXRhKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHZhdWx0czogW10sIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJHRVRfUkVDRU5UXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9yZWNlbnQ/bGltaXQ9MzBgKTtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoZGF0YSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBib29rbWFya3M6IFtdLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiR0VUX0NPTlRFTlRTXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHsgdmF1bHQ6IG1zZy52YXVsdCB8fCBcImRlZmF1bHRcIiB9KTtcbiAgICAgICAgICBpZiAobXNnLmZvbGRlcl9pZCkgcGFyYW1zLnNldChcImZvbGRlcl9pZFwiLCBtc2cuZm9sZGVyX2lkKTtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9jb250ZW50cz8ke3BhcmFtc31gKTtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCAuLi5kYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJDUkVBVEVfRk9MREVSXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9mb2xkZXJzYCwge1xuICAgICAgICAgICAgbWV0aG9kOiAgXCJQT1NUXCIsXG4gICAgICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgICAgICBib2R5OiAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIG5hbWU6ICAgICAgbXNnLm5hbWUsXG4gICAgICAgICAgICAgIHBhcmVudF9pZDogbXNnLnBhcmVudF9pZCB8fCBudWxsLFxuICAgICAgICAgICAgICB2YXVsdDogICAgIG1zZy52YXVsdCB8fCBcImRlZmF1bHRcIixcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgICAgICBjb25zdCBlcnIgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIuZGV0YWlsIHx8IFwiQ3JlYXRlIGZhaWxlZFwiIH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIGZvbGRlcjogZGF0YSB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZS5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlIFwiUkVOQU1FX0ZPTERFUlwiOiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vZm9sZGVycy8ke21zZy5mb2xkZXJfaWR9YCwge1xuICAgICAgICAgICAgbWV0aG9kOiAgXCJQQVRDSFwiLFxuICAgICAgICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICAgICAgYm9keTogICAgSlNPTi5zdHJpbmdpZnkoeyBuYW1lOiBtc2cubmFtZSB9KSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAoIXJlcy5vaykge1xuICAgICAgICAgICAgY29uc3QgZXJyID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyLmRldGFpbCB8fCBcIlJlbmFtZSBmYWlsZWRcIiB9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCBmb2xkZXI6IGRhdGEgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIkRFTEVURV9GT0xERVJcIjoge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlcyAgPSBhd2FpdCBmZXRjaChgJHtBUEl9L2ZvbGRlcnMvJHttc2cuZm9sZGVyX2lkfWAsIHsgbWV0aG9kOiBcIkRFTEVURVwiIH0pO1xuICAgICAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgICAgICBjb25zdCBlcnIgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnIuZGV0YWlsIHx8IFwiRGVsZXRlIGZhaWxlZFwiIH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIC4uLmRhdGEgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY2FzZSBcIkdFVF9GT0xERVJfUEFUSFwiOiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzICA9IGF3YWl0IGZldGNoKGAke0FQSX0vZm9sZGVycy8ke21zZy5mb2xkZXJfaWR9L3BhdGhgKTtcbiAgICAgICAgICBpZiAoIXJlcy5vaykge1xuICAgICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBcIkZvbGRlciBub3QgZm91bmRcIiB9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiB0cnVlLCAuLi5kYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgXCJNT1ZFX0JPT0tNQVJLXCI6IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXMgID0gYXdhaXQgZmV0Y2goYCR7QVBJfS9ib29rbWFyay8ke21zZy5ib29rbWFya19pZH0vbW92ZWAsIHtcbiAgICAgICAgICAgIG1ldGhvZDogIFwiUEFUQ0hcIixcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgICAgIGJvZHk6ICAgIEpTT04uc3RyaW5naWZ5KHsgZm9sZGVyX2lkOiBtc2cuZm9sZGVyX2lkIHx8IG51bGwgfSksXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICAgICAgICBzZW5kUmVzcG9uc2UoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVyci5kZXRhaWwgfHwgXCJNb3ZlIGZhaWxlZFwiIH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXMuanNvbigpO1xuICAgICAgICAgIHNlbmRSZXNwb25zZSh7IHN1Y2Nlc3M6IHRydWUsIGJvb2ttYXJrOiBkYXRhIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgc2VuZFJlc3BvbnNlKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlLm1lc3NhZ2UgfSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICB9XG4gIH0pKCk7XG4gIHJldHVybiB0cnVlO1xufSk7XG5cblxuLy8g4pSA4pSAIEJ1bGsgb3BlbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmFzeW5jIGZ1bmN0aW9uIG9wZW5JdGVtcyh7IGFjdGlvbiwgZ3JvdXBCeSwgZ3JvdXBzLCBzaW5nbGVMYWJlbCB9KSB7XG4gIGNvbnN0IGFsbFVybHMgPSBncm91cHMuZmxhdE1hcChnID0+IGcudXJscyk7XG4gIGlmIChhbGxVcmxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgb3BlbmVkOiAwIH07XG5cbiAgaWYgKGFjdGlvbiA9PT0gXCJjdXJyZW50XCIpIHtcbiAgICBmb3IgKGNvbnN0IHVybCBvZiBhbGxVcmxzKSB7XG4gICAgICBhd2FpdCBjaHJvbWUudGFicy5jcmVhdGUoeyB1cmwsIGFjdGl2ZTogZmFsc2UgfSk7XG4gICAgfVxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG9wZW5lZDogYWxsVXJscy5sZW5ndGggfTtcbiAgfVxuXG4gIGlmIChhY3Rpb24gPT09IFwibmV3V2luZG93XCIgfHwgYWN0aW9uID09PSBcImluY29nbml0b1wiKSB7XG4gICAgY29uc3Qgd2luID0gYXdhaXQgY2hyb21lLndpbmRvd3MuY3JlYXRlKHtcbiAgICAgIHVybDogYWxsVXJsc1swXSxcbiAgICAgIGluY29nbml0bzogYWN0aW9uID09PSBcImluY29nbml0b1wiLFxuICAgIH0pO1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgYWxsVXJscy5sZW5ndGg7IGkrKykge1xuICAgICAgYXdhaXQgY2hyb21lLnRhYnMuY3JlYXRlKHsgd2luZG93SWQ6IHdpbi5pZCwgdXJsOiBhbGxVcmxzW2ldLCBhY3RpdmU6IGZhbHNlIH0pO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBvcGVuZWQ6IGFsbFVybHMubGVuZ3RoLCB3aW5kb3dJZDogd2luLmlkIH07XG4gIH1cblxuICBpZiAoYWN0aW9uID09PSBcInRhYkdyb3VwXCIpIHtcbiAgICBjb25zdCBncm91cElkcyA9IFtdO1xuXG4gICAgaWYgKGdyb3VwQnkgPT09IFwicGVyRm9sZGVyXCIpIHtcbiAgICAgIC8vIE9uZSB0YWIgZ3JvdXAgcGVyIGZvbGRlci9zb3VyY2UsIGVhY2ggbmFtZWQgYWZ0ZXIgaXRzIGxhYmVsXG4gICAgICBmb3IgKGNvbnN0IGcgb2YgZ3JvdXBzKSB7XG4gICAgICAgIGlmIChnLnVybHMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdGFiSWRzID0gW107XG4gICAgICAgIGZvciAoY29uc3QgdXJsIG9mIGcudXJscykge1xuICAgICAgICAgIGNvbnN0IHRhYiA9IGF3YWl0IGNocm9tZS50YWJzLmNyZWF0ZSh7IHVybCwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgICAgICAgICB0YWJJZHMucHVzaCh0YWIuaWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCBjaHJvbWUudGFicy5ncm91cCh7IHRhYklkcyB9KTtcbiAgICAgICAgYXdhaXQgY2hyb21lLnRhYkdyb3Vwcy51cGRhdGUoZ3JvdXBJZCwgeyB0aXRsZTogZy5sYWJlbCB9KTtcbiAgICAgICAgZ3JvdXBJZHMucHVzaChncm91cElkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2luZ2xlIGNvbWJpbmVkIGdyb3VwIChtYXRjaGVzIENocm9tZSdzIG5hdGl2ZSBib29rbWFyayBtYW5hZ2VyIGJlaGF2aW9yKVxuICAgICAgY29uc3QgdGFiSWRzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHVybCBvZiBhbGxVcmxzKSB7XG4gICAgICAgIGNvbnN0IHRhYiA9IGF3YWl0IGNocm9tZS50YWJzLmNyZWF0ZSh7IHVybCwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgICAgICAgdGFiSWRzLnB1c2godGFiLmlkKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCBjaHJvbWUudGFicy5ncm91cCh7IHRhYklkcyB9KTtcbiAgICAgIGF3YWl0IGNocm9tZS50YWJHcm91cHMudXBkYXRlKGdyb3VwSWQsIHsgdGl0bGU6IHNpbmdsZUxhYmVsIHx8IFwiT3BlbmVkIEJvb2ttYXJrc1wiIH0pO1xuICAgICAgZ3JvdXBJZHMucHVzaChncm91cElkKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBvcGVuZWQ6IGFsbFVybHMubGVuZ3RoLCBncm91cElkcyB9O1xuICB9XG5cbiAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgVW5rbm93biBhY3Rpb246ICR7YWN0aW9ufWAgfTtcbn1cblxuXG5cblxufSk7IiwiLy8gI3JlZ2lvbiBzbmlwcGV0XG5leHBvcnQgY29uc3QgYnJvd3NlciA9IGdsb2JhbFRoaXMuYnJvd3Nlcj8ucnVudGltZT8uaWRcbiAgPyBnbG9iYWxUaGlzLmJyb3dzZXJcbiAgOiBnbG9iYWxUaGlzLmNocm9tZTtcbi8vICNlbmRyZWdpb24gc25pcHBldFxuIiwiaW1wb3J0IHsgYnJvd3NlciBhcyBicm93c2VyJDEgfSBmcm9tIFwiQHd4dC1kZXYvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy9icm93c2VyLnRzXG4vKipcbiogQ29udGFpbnMgdGhlIGBicm93c2VyYCBleHBvcnQgd2hpY2ggeW91IHNob3VsZCB1c2UgdG8gYWNjZXNzIHRoZSBleHRlbnNpb25cbiogQVBJcyBpbiB5b3VyIHByb2plY3Q6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IGJyb3dzZXIgfSBmcm9tICd3eHQvYnJvd3Nlcic7XG4qXG4qIGJyb3dzZXIucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XG4qICAgLy8gLi4uXG4qIH0pO1xuKiBgYGBcbipcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGJyb3dzZXIgfTtcbiIsIi8vIHNyYy9pbmRleC50c1xudmFyIF9NYXRjaFBhdHRlcm4gPSBjbGFzcyB7XG4gIGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybikge1xuICAgIGlmIChtYXRjaFBhdHRlcm4gPT09IFwiPGFsbF91cmxzPlwiKSB7XG4gICAgICB0aGlzLmlzQWxsVXJscyA9IHRydWU7XG4gICAgICB0aGlzLnByb3RvY29sTWF0Y2hlcyA9IFsuLi5fTWF0Y2hQYXR0ZXJuLlBST1RPQ09MU107XG4gICAgICB0aGlzLmhvc3RuYW1lTWF0Y2ggPSBcIipcIjtcbiAgICAgIHRoaXMucGF0aG5hbWVNYXRjaCA9IFwiKlwiO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBncm91cHMgPSAvKC4qKTpcXC9cXC8oLio/KShcXC8uKikvLmV4ZWMobWF0Y2hQYXR0ZXJuKTtcbiAgICAgIGlmIChncm91cHMgPT0gbnVsbClcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBcIkluY29ycmVjdCBmb3JtYXRcIik7XG4gICAgICBjb25zdCBbXywgcHJvdG9jb2wsIGhvc3RuYW1lLCBwYXRobmFtZV0gPSBncm91cHM7XG4gICAgICB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpO1xuICAgICAgdmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKTtcbiAgICAgIHZhbGlkYXRlUGF0aG5hbWUobWF0Y2hQYXR0ZXJuLCBwYXRobmFtZSk7XG4gICAgICB0aGlzLnByb3RvY29sTWF0Y2hlcyA9IHByb3RvY29sID09PSBcIipcIiA/IFtcImh0dHBcIiwgXCJodHRwc1wiXSA6IFtwcm90b2NvbF07XG4gICAgICB0aGlzLmhvc3RuYW1lTWF0Y2ggPSBob3N0bmFtZTtcbiAgICAgIHRoaXMucGF0aG5hbWVNYXRjaCA9IHBhdGhuYW1lO1xuICAgIH1cbiAgfVxuICBpbmNsdWRlcyh1cmwpIHtcbiAgICBpZiAodGhpcy5pc0FsbFVybHMpXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB1ID0gdHlwZW9mIHVybCA9PT0gXCJzdHJpbmdcIiA/IG5ldyBVUkwodXJsKSA6IHVybCBpbnN0YW5jZW9mIExvY2F0aW9uID8gbmV3IFVSTCh1cmwuaHJlZikgOiB1cmw7XG4gICAgcmV0dXJuICEhdGhpcy5wcm90b2NvbE1hdGNoZXMuZmluZCgocHJvdG9jb2wpID0+IHtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJodHRwXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzSHR0cE1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImh0dHBzXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzSHR0cHNNYXRjaCh1KTtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJmaWxlXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzRmlsZU1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImZ0cFwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc0Z0cE1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcInVyblwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc1Vybk1hdGNoKHUpO1xuICAgIH0pO1xuICB9XG4gIGlzSHR0cE1hdGNoKHVybCkge1xuICAgIHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cDpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuICB9XG4gIGlzSHR0cHNNYXRjaCh1cmwpIHtcbiAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHBzOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG4gIH1cbiAgaXNIb3N0UGF0aE1hdGNoKHVybCkge1xuICAgIGlmICghdGhpcy5ob3N0bmFtZU1hdGNoIHx8ICF0aGlzLnBhdGhuYW1lTWF0Y2gpXG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgaG9zdG5hbWVNYXRjaFJlZ2V4cyA9IFtcbiAgICAgIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaCksXG4gICAgICB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLmhvc3RuYW1lTWF0Y2gucmVwbGFjZSgvXlxcKlxcLi8sIFwiXCIpKVxuICAgIF07XG4gICAgY29uc3QgcGF0aG5hbWVNYXRjaFJlZ2V4ID0gdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5wYXRobmFtZU1hdGNoKTtcbiAgICByZXR1cm4gISFob3N0bmFtZU1hdGNoUmVnZXhzLmZpbmQoKHJlZ2V4KSA9PiByZWdleC50ZXN0KHVybC5ob3N0bmFtZSkpICYmIHBhdGhuYW1lTWF0Y2hSZWdleC50ZXN0KHVybC5wYXRobmFtZSk7XG4gIH1cbiAgaXNGaWxlTWF0Y2godXJsKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZpbGU6Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuICB9XG4gIGlzRnRwTWF0Y2godXJsKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZ0cDovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG4gIH1cbiAgaXNVcm5NYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogdXJuOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcbiAgfVxuICBjb252ZXJ0UGF0dGVyblRvUmVnZXgocGF0dGVybikge1xuICAgIGNvbnN0IGVzY2FwZWQgPSB0aGlzLmVzY2FwZUZvclJlZ2V4KHBhdHRlcm4pO1xuICAgIGNvbnN0IHN0YXJzUmVwbGFjZWQgPSBlc2NhcGVkLnJlcGxhY2UoL1xcXFxcXCovZywgXCIuKlwiKTtcbiAgICByZXR1cm4gUmVnRXhwKGBeJHtzdGFyc1JlcGxhY2VkfSRgKTtcbiAgfVxuICBlc2NhcGVGb3JSZWdleChzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKTtcbiAgfVxufTtcbnZhciBNYXRjaFBhdHRlcm4gPSBfTWF0Y2hQYXR0ZXJuO1xuTWF0Y2hQYXR0ZXJuLlBST1RPQ09MUyA9IFtcImh0dHBcIiwgXCJodHRwc1wiLCBcImZpbGVcIiwgXCJmdHBcIiwgXCJ1cm5cIl07XG52YXIgSW52YWxpZE1hdGNoUGF0dGVybiA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4sIHJlYXNvbikge1xuICAgIHN1cGVyKGBJbnZhbGlkIG1hdGNoIHBhdHRlcm4gXCIke21hdGNoUGF0dGVybn1cIjogJHtyZWFzb259YCk7XG4gIH1cbn07XG5mdW5jdGlvbiB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpIHtcbiAgaWYgKCFNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmluY2x1ZGVzKHByb3RvY29sKSAmJiBwcm90b2NvbCAhPT0gXCIqXCIpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4oXG4gICAgICBtYXRjaFBhdHRlcm4sXG4gICAgICBgJHtwcm90b2NvbH0gbm90IGEgdmFsaWQgcHJvdG9jb2wgKCR7TWF0Y2hQYXR0ZXJuLlBST1RPQ09MUy5qb2luKFwiLCBcIil9KWBcbiAgICApO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKSB7XG4gIGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIjpcIikpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBgSG9zdG5hbWUgY2Fubm90IGluY2x1ZGUgYSBwb3J0YCk7XG4gIGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIipcIikgJiYgaG9zdG5hbWUubGVuZ3RoID4gMSAmJiAhaG9zdG5hbWUuc3RhcnRzV2l0aChcIiouXCIpKVxuICAgIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKFxuICAgICAgbWF0Y2hQYXR0ZXJuLFxuICAgICAgYElmIHVzaW5nIGEgd2lsZGNhcmQgKCopLCBpdCBtdXN0IGdvIGF0IHRoZSBzdGFydCBvZiB0aGUgaG9zdG5hbWVgXG4gICAgKTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlUGF0aG5hbWUobWF0Y2hQYXR0ZXJuLCBwYXRobmFtZSkge1xuICByZXR1cm47XG59XG5leHBvcnQge1xuICBJbnZhbGlkTWF0Y2hQYXR0ZXJuLFxuICBNYXRjaFBhdHRlcm5cbn07XG4iXSwieF9nb29nbGVfaWdub3JlTGlzdCI6WzAsMiwzLDRdLCJtYXBwaW5ncyI6Ijs7Q0FDQSxTQUFTLGlCQUFpQixLQUFLO0VBQzlCLElBQUksT0FBTyxRQUFRLE9BQU8sUUFBUSxZQUFZLE9BQU8sRUFBRSxNQUFNLElBQUk7RUFDakUsT0FBTztDQUNSOzs7Q0NKQSxJQUFBLHFCQUFBLHVCQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7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