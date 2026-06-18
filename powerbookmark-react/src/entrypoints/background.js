export default defineBackground(() => {
  const API = "http://127.0.0.1:8765";

// ── Badge helpers ──────────────────────────────────────────────────────────
function setBadge(tabId, state) {
  const states = {
    unsaved:  { text: "+",  color: "#888888" },
    saved:    { text: "✓",  color: "#22c55e" },
    archived: { text: "📦", color: "#3b82f6" },
    error:    { text: "!",  color: "#ef4444" },
    loading:  { text: "…",  color: "#f59e0b" },
  };
  const s = states[state] || states.unsaved;
  chrome.action.setBadgeText({ text: s.text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: s.color, tabId });
}

// ── URL normalization (mirrors Python logic) ───────────────────────────────
const TRACKING = new Set([
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "fbclid","gclid","ref","source","mc_eid","mc_cid"
]);

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

// ── Lookup tab state ───────────────────────────────────────────────────────
async function lookupTab(tabId, url) {
  if (!url || url.startsWith("chrome://") || url.startsWith("about:")) {
    setBadge(tabId, "unsaved");
    return null;
  }
  setBadge(tabId, "loading");
  try {
    const norm = encodeURIComponent(normalizeUrl(url));
    const res  = await fetch(`${API}/lookup?url=${norm}`);
    if (!res.ok) throw new Error("lookup failed");
    const data = await res.json();
    if (data.exists) {
      setBadge(tabId, data.archived ? "archived" : "saved");
    } else {
      setBadge(tabId, "unsaved");
    }
    return data;
  } catch {
    setBadge(tabId, "error");
    return null;
  }
}

// ── Tab event listeners ────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await lookupTab(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status === "complete" && tab.active) {
    await lookupTab(tabId, tab.url);
  }
});

// ── Screenshot capture ─────────────────────────────────────────────────────
async function captureScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "jpeg",
      quality: 85,
    });
    return dataUrl;
  } catch (e) {
    console.error("Screenshot failed:", e);
    return null;
  }
}

// ── HTML capture via SingleFile content script ─────────────────────────────
async function captureHtml(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      // IMPORTANT: Use the new bundled file!
      files: ["single-file-bundled.js", "content.js"], 
    });
  } catch (e) {
    console.warn("PowerBookmark: script injection failed", e);
    return null;
  }

  await new Promise(r => setTimeout(r, 150));

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_HTML" });
    if (!response || !response.b64) throw new Error("No HTML returned");
    return response.b64; // Return the base64 string directly
  } catch (e) {
    console.warn("HTML capture failed after injection:", e);
    return null;
  }
}

// ── Message handler (from popup / content script) ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case "LOOKUP": {
        const result = await lookupTab(msg.tabId, msg.url);
        sendResponse(result);
        break;
      }
      
      case "PROXY_FETCH": {
        fetch(msg.url)
          .then(async (res) => {
            const blob = await res.blob();
            const headers = {};
            res.headers.forEach((val, key) => { headers[key] = val; });

            const reader = new FileReader();
            reader.onloadend = () => {
              sendResponse({ base64: reader.result, headers });
            };
            reader.readAsDataURL(blob);
          })
          .catch(err => {
            sendResponse({ error: err.message });
          });
        break; // Don't forget the break!
      }

      case "SAVE": {
        const { tabId, url, title, vault, tags, archive, notes, folder_id } = msg;

        let favicon_url = "";
        try {
          const tab = await chrome.tabs.get(tabId);
          favicon_url = tab.favIconUrl || "";
        } catch (e) {
          console.warn("Favicon capture failed:", e);
        }

        const screenshotData = await captureScreenshot(tabId);

        let htmlData = null;
        if (archive) {
          htmlData = await captureHtml(tabId);
        }

        try {
          const res = await fetch(`${API}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url, title, vault, tags, archive,
              screenshot: !!screenshotData,
              notes,
              folder_id: folder_id || null,
              favicon_url,
              screenshot_data: screenshotData,
              html_data: htmlData,
            }),
          });
          const data = await res.json();
          setBadge(tabId, archive && htmlData ? "archived" : "saved");
          sendResponse({ success: true, ...data });
        } catch (e) {
          setBadge(tabId, "error");
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "OPEN_ITEMS": {
        try {
          const result = await openItems({
            action: msg.action,
            groupBy: msg.groupBy,
            groups: msg.groups,
            singleLabel: msg.singleLabel,
          });
          sendResponse(result);
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "DELETE": {
        try {
          const res  = await fetch(`${API}/bookmark/${msg.id}`, { method: "DELETE" });
          const data = await res.json();
          const tab  = await chrome.tabs.get(msg.tabId);
          await lookupTab(msg.tabId, tab.url);
          sendResponse({ success: true, ...data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "SEARCH": {
        try {
          const res  = await fetch(
            `${API}/search?q=${encodeURIComponent(msg.q)}${msg.vault ? "&vault=" + msg.vault : ""}`
          );
          const data = await res.json();
          sendResponse(data);
        } catch (e) {
          sendResponse({ results: [], error: e.message });
        }
        break;
      }

      case "GET_VAULTS": {
        try {
          const res  = await fetch(`${API}/vaults`);
          const data = await res.json();
          sendResponse(data);
        } catch (e) {
          sendResponse({ vaults: [], error: e.message });
        }
        break;
      }

      case "GET_RECENT": {
        try {
          const res  = await fetch(`${API}/recent?limit=30`);
          const data = await res.json();
          sendResponse(data);
        } catch (e) {
          sendResponse({ bookmarks: [], error: e.message });
        }
        break;
      }

      case "GET_CONTENTS": {
        try {
          const params = new URLSearchParams({ vault: msg.vault || "default" });
          if (msg.folder_id) params.set("folder_id", msg.folder_id);
          const res  = await fetch(`${API}/contents?${params}`);
          const data = await res.json();
          sendResponse({ success: true, ...data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "CREATE_FOLDER": {
        try {
          const res  = await fetch(`${API}/folders`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              name:      msg.name,
              parent_id: msg.parent_id || null,
              vault:     msg.vault || "default",
            }),
          });
          if (!res.ok) {
            const err = await res.json();
            sendResponse({ success: false, error: err.detail || "Create failed" });
            break;
          }
          const data = await res.json();
          sendResponse({ success: true, folder: data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "RENAME_FOLDER": {
        try {
          const res  = await fetch(`${API}/folders/${msg.folder_id}`, {
            method:  "PATCH",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ name: msg.name }),
          });
          if (!res.ok) {
            const err = await res.json();
            sendResponse({ success: false, error: err.detail || "Rename failed" });
            break;
          }
          const data = await res.json();
          sendResponse({ success: true, folder: data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "DELETE_FOLDER": {
        try {
          const res  = await fetch(`${API}/folders/${msg.folder_id}`, { method: "DELETE" });
          if (!res.ok) {
            const err = await res.json();
            sendResponse({ success: false, error: err.detail || "Delete failed" });
            break;
          }
          const data = await res.json();
          sendResponse({ success: true, ...data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "GET_FOLDER_PATH": {
        try {
          const res  = await fetch(`${API}/folders/${msg.folder_id}/path`);
          if (!res.ok) {
            sendResponse({ success: false, error: "Folder not found" });
            break;
          }
          const data = await res.json();
          sendResponse({ success: true, ...data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case "MOVE_BOOKMARK": {
        try {
          const res  = await fetch(`${API}/bookmark/${msg.bookmark_id}/move`, {
            method:  "PATCH",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ folder_id: msg.folder_id || null }),
          });
          if (!res.ok) {
            const err = await res.json();
            sendResponse({ success: false, error: err.detail || "Move failed" });
            break;
          }
          const data = await res.json();
          sendResponse({ success: true, bookmark: data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

    }
  })();
  return true;
});


// ── Bulk open ───────────────────────────────────────────────────────────────
async function openItems({ action, groupBy, groups, singleLabel }) {
  const allUrls = groups.flatMap(g => g.urls);
  if (allUrls.length === 0) return { success: true, opened: 0 };

  if (action === "current") {
    for (const url of allUrls) {
      await chrome.tabs.create({ url, active: false });
    }
    return { success: true, opened: allUrls.length };
  }

  if (action === "newWindow" || action === "incognito") {
    const win = await chrome.windows.create({
      url: allUrls[0],
      incognito: action === "incognito",
    });
    for (let i = 1; i < allUrls.length; i++) {
      await chrome.tabs.create({ windowId: win.id, url: allUrls[i], active: false });
    }
    return { success: true, opened: allUrls.length, windowId: win.id };
  }

  if (action === "tabGroup") {
    const groupIds = [];

    if (groupBy === "perFolder") {
      // One tab group per folder/source, each named after its label
      for (const g of groups) {
        if (g.urls.length === 0) continue;
        const tabIds = [];
        for (const url of g.urls) {
          const tab = await chrome.tabs.create({ url, active: false });
          tabIds.push(tab.id);
        }
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: g.label });
        groupIds.push(groupId);
      }
    } else {
      // Single combined group (matches Chrome's native bookmark manager behavior)
      const tabIds = [];
      for (const url of allUrls) {
        const tab = await chrome.tabs.create({ url, active: false });
        tabIds.push(tab.id);
      }
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: singleLabel || "Opened Bookmarks" });
      groupIds.push(groupId);
    }

    return { success: true, opened: allUrls.length, groupIds };
  }

  return { success: false, error: `Unknown action: ${action}` };
}




});