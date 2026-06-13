// popup.js — PowerBookmark popup controller
const API = "http://127.0.0.1:8765";

let currentTab = null;
let bookmarkId = null;
let isSaved = false;

// ── Save-tab Folder Navigator State ───────────────────────────────────────
let fnavStack = [{ id: null, name: "Root" }];
let fnavCurrentItems = [];
let fnavSelected = null;   // { id, name } or null = root

// ── Explorer-tab State ─────────────────────────────────────────────────────
let expStack = [{ id: null, name: "Root" }];
let expSearchTimer = null;
let expSearchMode = false;

// ── Last-folder memory key ─────────────────────────────────────────────────
const LAST_FOLDER_KEY = "pb_last_folder"; // { vault, folder_id, folder_name }

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
async function init() {
  el("openDashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  el("pageTitle").textContent = tab.title || "Untitled";
  el("pageUrl").textContent = tab.url || "";

  // Check service health
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error();
    el("offlineBanner").classList.remove("show");
  } catch {
    el("offlineBanner").classList.add("show");
    el("btnSave").disabled = true;
  }

  // IMPORTANT: loadVaults must complete before restoreLastFolder
  await loadVaults();

  fnavWireEvents();
  await fnavNavigateTo(null, "Root");

  // lookupCurrent handles both "already saved" (restore exact folder)
  // and "unsaved" (restore last-used folder via restoreLastFolder)
  await lookupCurrent();

  // Wire vault change AFTER initial load
  el("vaultSelect").addEventListener("change", async () => {
    fnavReset();
    await fnavNavigateTo(null, "Root");
  });

  // Wire explorer tab
  expWireEvents();

  // Wire tab switching
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      el(`panel-${t.dataset.tab}`).classList.add("active");

      // Lazy-load explorer on first open
      if (t.dataset.tab === "explorer" && expStack.length === 1 && !expSearchMode) {
        await expNavigateTo(null, "Root");
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VAULTS
// ═══════════════════════════════════════════════════════════════════════════
async function loadVaults() {
  try {
    const res = await fetch(`${API}/vaults`);
    const data = await res.json();
    const sel = el("vaultSelect");
    sel.innerHTML = "";
    const defaults = ["default", "research", "work", "personal", "read-later"];
    const existing = new Set(data.vaults.map(v => v.name));
    [...new Set([...defaults, ...data.vaults.map(v => v.name)])].forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `📁 ${name}${existing.has(name)
        ? ` (${data.vaults.find(v => v.name === name)?.count || 0})`
        : ""}`;
      sel.appendChild(opt);
    });
  } catch { }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAST-FOLDER MEMORY
// ═══════════════════════════════════════════════════════════════════════════
async function saveLastFolder() {
  try {
    await chrome.storage.local.set({
      [LAST_FOLDER_KEY]: {
        vault: el("vaultSelect").value,
        folder_id: fnavSelected?.id ?? null,
        folder_name: fnavSelected?.name ?? null,
      },
    });
  } catch (e) {
    console.warn("PowerBookmark: could not save last folder", e);
  }
}

async function restoreLastFolder() {
  try {
    const stored = await chrome.storage.local.get(LAST_FOLDER_KEY);
    const last = stored[LAST_FOLDER_KEY];
    if (!last) return;

    // Set vault — select is already populated
    const sel = el("vaultSelect");
    const match = [...sel.options].find(o => o.value === last.vault);
    if (match) sel.value = last.vault;

    // Restore folder navigator using the path API
    if (last.folder_id) {
      await fnavRestoreFolder(last.folder_id, last.vault);
    }
  } catch (e) {
    console.warn("PowerBookmark: could not restore last folder", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE-TAB FOLDER NAVIGATOR  (fnav*)
// ═══════════════════════════════════════════════════════════════════════════
function fnavWireEvents() {
  el("fnavBack").addEventListener("click", fnavGoBack);

  el("fnavNew").addEventListener("click", () => {
    el("fnavNew").style.display = "none";
    el("fnavCreateWrap").classList.add("show");
    el("fnavNameInput").value = "";
    el("fnavNameInput").focus();
  });

  el("fnavCreateCancel").addEventListener("click", fnavHideCreate);

  el("fnavNameInput").addEventListener("keydown", e => {
    if (e.key === "Enter") fnavCreateFolder();
    if (e.key === "Escape") fnavHideCreate();
  });

  el("fnavCreateOk").addEventListener("click", fnavCreateFolder);

  // UPDATED: Now falls back to your active folder instead of Root
  el("fnavDestClear").addEventListener("click", () => {
    const cur = fnavStack[fnavStack.length - 1];
    fnavSelected = { id: cur.id, name: cur.name };
    fnavRenderDestination();
    fnavRenderList();
    fnavRenderSelectCurrent();
  });
}

function fnavHideCreate() {
  el("fnavCreateWrap").classList.remove("show");
  el("fnavNew").style.display = "";
  el("fnavNameInput").value = "";
}

function fnavReset() {
  fnavStack = [{ id: null, name: "Root" }];
  fnavCurrentItems = [];
  fnavSelected = null;
  fnavRenderDestination();
}

async function fnavNavigateTo(folder_id, folder_name) {
  const vault = el("vaultSelect").value;

  if (folder_id === null) {
    fnavStack = [{ id: null, name: "Root" }];
  } else {
    const top = fnavStack[fnavStack.length - 1];
    if (top.id !== folder_id) fnavStack.push({ id: folder_id, name: folder_name });
  }

  // MAGIC AUTO-SELECT: Whenever you move, automatically select your current location
  const cur = fnavStack[fnavStack.length - 1];
  fnavSelected = { id: cur.id, name: cur.name };

  try {
    const params = new URLSearchParams({ vault });
    if (folder_id) params.set("folder_id", folder_id);
    const res = await fetch(`${API}/contents?${params}`);
    const data = await res.json();
    fnavCurrentItems = data.subfolders || [];
  } catch {
    fnavCurrentItems = [];
  }

  fnavRenderBreadcrumb();
  fnavRenderList();
  fnavRenderDestination();
  el("fnavBack").disabled = fnavStack.length <= 1;
  fnavRenderSelectCurrent();
}

function fnavGoBack() {
  if (fnavStack.length <= 1) return;
  fnavStack.pop();
  const top = fnavStack[fnavStack.length - 1];
  fnavNavigateTo(top.id, top.name);
}

function fnavRenderSelectCurrent() {
  const cur = fnavStack[fnavStack.length - 1];
  let btn = el("fnavSelectCurrent");

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "fnavSelectCurrent";
    btn.className = "fnav-new"; // Reusing the clean styles from the "New Folder" button
    el("fnavBack").parentNode.insertBefore(btn, el("fnavNew"));
  }

  const isHere = fnavSelected?.id === cur.id;

  if (isHere) {
    // We are safely targeting the folder we are standing in
    btn.textContent = "✓ Saving here";
    btn.style.color = "var(--green)";
    btn.style.borderColor = "transparent";
    btn.style.cursor = "default";
    btn.onclick = null;
  } else {
    // We selected a subfolder, so this button becomes our escape hatch to revert
    btn.textContent = `← Re-select ${cur.name}`;
    btn.style.color = "var(--blue)";
    btn.style.borderColor = "var(--blue)";
    btn.style.cursor = "pointer";
    btn.onclick = () => { fnavSelectFolder(cur); };
  }
}

function fnavRenderBreadcrumb() {
  const bar = el("fnavBreadcrumb");
  bar.innerHTML = "";
  fnavStack.forEach((crumb, i) => {
    const isLast = i === fnavStack.length - 1;
    const span = document.createElement("span");
    span.className = `fnav-crumb${isLast ? " current" : ""}`;
    span.textContent = i === 0 ? "📂 Root" : `📁 ${crumb.name}`;
    if (!isLast) span.addEventListener("click", () => {
      fnavStack = fnavStack.slice(0, i + 1);
      fnavNavigateTo(crumb.id, crumb.name);
    });
    bar.appendChild(span);
    if (!isLast) {
      const sep = document.createElement("span");
      sep.className = "fnav-sep"; sep.textContent = " › ";
      bar.appendChild(sep);
    }
  });
  bar.scrollLeft = bar.scrollWidth;
}

function fnavRenderList() {
  const list = el("fnavList");
  list.innerHTML = "";
  if (!fnavCurrentItems.length) {
    const empty = document.createElement("div");
    empty.className = "fnav-empty";
    empty.textContent = "No subfolders here";
    list.appendChild(empty);
    return;
  }
  for (const f of fnavCurrentItems) {
    const row = document.createElement("div");
    row.className = "fnav-row";
    // Make the whole row behave like a button
    row.style.cursor = "pointer";

    // NAVIGATION TRIGGER: Clicking anywhere in the row (except the select button)
    row.addEventListener("click", (e) => {
      // If the target is the select button, don't navigate
      if (e.target.closest(".fnav-row-select")) return;
      fnavNavigateTo(f.id, f.name);
    });

    const icon = document.createElement("span");
    icon.className = "fnav-row-icon"; icon.textContent = "📁";

    const name = document.createElement("span");
    name.className = "fnav-row-name";
    name.textContent = f.name;

    const selBtn = document.createElement("button");
    selBtn.className = "fnav-row-select" + (fnavSelected?.id === f.id ? " selected" : "");
    selBtn.textContent = fnavSelected?.id === f.id ? "✓" : "Select";

    // We keep the listener here to explicitly handle the selection
    selBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Very important: stops the click from bubbling up to the row
      fnavSelectFolder(f);
    });

    row.append(icon, name, selBtn);
    list.appendChild(row);
  }
}

function fnavSelectFolder(f) {
  const cur = fnavStack[fnavStack.length - 1];

  if (fnavSelected?.id === f.id) {
    // Toggling OFF a subfolder reverts back to our physical location
    fnavSelected = { id: cur.id, name: cur.name };
  } else {
    // Toggling ON selects the specific target
    fnavSelected = { id: f.id, name: f.name };
  }

  fnavRenderList();
  fnavRenderDestination();
  fnavRenderSelectCurrent();
}

function fnavRenderDestination() {
  el("fnavDestValue").textContent = fnavSelected ? `📁 ${fnavSelected.name}` : "📂 Root";
}

async function fnavCreateFolder() {
  const name = el("fnavNameInput").value.trim();
  if (!name) return;
  const vault = el("vaultSelect").value;
  const parent_id = fnavStack[fnavStack.length - 1].id || null;
  el("fnavCreateOk").disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "CREATE_FOLDER", name, parent_id, vault });
    if (res.success) {
      fnavHideCreate();
      toast(`📁 "${name}" created`);
      const top = fnavStack[fnavStack.length - 1];
      await fnavNavigateTo(top.id, top.name);
      fnavSelectFolder(res.folder);
    } else {
      toast("❌ " + (res.error || "Could not create folder"));
    }
  } catch (e) { toast("❌ " + e.message); }
  finally { el("fnavCreateOk").disabled = false; }
}

// ── Restore folder from a folder_id by fetching its ancestor path ──────────
// FIX: was calling /folder/{id} (wrong), now calls /folders/{id}/path (correct)
async function fnavRestoreFolder(folder_id, vault) {
  if (!folder_id) { fnavReset(); await fnavNavigateTo(null, "Root"); return; }
  try {
    const res = await fetch(`${API}/folders/${folder_id}/path`);
    if (!res.ok) throw new Error("folder not found");
    const data = await res.json();

    // data.breadcrumb = [{id, name}, ...] root → target folder
    // data.ancestors  = breadcrumb minus the last item (nodes above target)
    const breadcrumb = data.breadcrumb || [];
    if (!breadcrumb.length) throw new Error("empty breadcrumb");

    // Rebuild stack: Root + every node in breadcrumb except the last
    // (the last is the target folder itself; we navigate INTO its parent,
    //  then select it from the list)
    fnavStack = [{ id: null, name: "Root" }];
    for (const node of breadcrumb.slice(0, -1)) {
      fnavStack.push({ id: node.id, name: node.name });
    }

    // Navigate to the parent level to load the list containing our target
    const parentFrame = fnavStack[fnavStack.length - 1];
    await fnavNavigateTo(parentFrame.id, parentFrame.name);

    // Now select the target folder from the loaded list
    const target = fnavCurrentItems.find(f => f.id === folder_id);
    if (target) fnavSelectFolder(target);
  } catch (e) {
    console.warn("PowerBookmark: fnavRestoreFolder failed", e);
    fnavReset();
    await fnavNavigateTo(null, "Root");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP CURRENT URL
// ═══════════════════════════════════════════════════════════════════════════
async function lookupCurrent() {
  if (!currentTab?.url) return;
  try {
    const res = await fetch(`${API}/lookup?url=${encodeURIComponent(currentTab.url)}`);
    const data = await res.json();
    isSaved = data.exists;
    bookmarkId = data.bookmark_id || null;

    if (isSaved) {
      const bRes = await fetch(`${API}/bookmark/${bookmarkId}`);
      const bm = await bRes.json();
      el("vaultSelect").value = bm.vault || "default";
      el("tagsInput").value = (bm.tags || []).join(", ");
      el("notesInput").value = bm.notes || "";
      el("chkArchive").checked = !!bm.archived;
      syncToggle("toggleArchive", "chkArchive");
      await fnavRestoreFolder(bm.folder_id || null, bm.vault || "default");
      el("btnSave").textContent = "Update Bookmark";
      el("btnDelete").style.display = "inline-block";
      el("dupWarning").classList.add("show");
      updateStatusChip(bm.archived ? "archived" : "saved");
    } else {
      await restoreLastFolder();
      el("btnSave").textContent = "Save Bookmark";
      el("btnDelete").style.display = "none";
      el("dupWarning").classList.remove("show");
      updateStatusChip("unsaved");
    }
  } catch { updateStatusChip("error"); }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPLORER TAB
// ═══════════════════════════════════════════════════════════════════════════
function expWireEvents() {
  el("expBack").addEventListener("click", expGoBack);

  el("expSearchInput").addEventListener("keydown", e => {
    if (e.key === "Enter") expDoSearch("local");
  });
  el("expSearchInput").addEventListener("input", () => {
    if (!el("expSearchInput").value.trim()) {
      expSearchMode = false;
      expNavigateTo(expStack[expStack.length - 1].id, expStack[expStack.length - 1].name);
    }
  });

  el("btnSearchLocal").addEventListener("click", () => expDoSearch("local"));
  el("btnSearchGlobal").addEventListener("click", () => expDoSearch("global"));
}

async function expNavigateTo(folder_id, folder_name) {
  expSearchMode = false;
  el("expSearchInput").value = "";
  expRenderSearchBtns(false);

  if (folder_id === null) {
    expStack = [{ id: null, name: "Root" }];
  } else {
    const top = expStack[expStack.length - 1];
    if (top.id !== folder_id) expStack.push({ id: folder_id, name: folder_name });
  }

  el("expBack").disabled = expStack.length <= 1;
  expRenderBreadcrumb();
  expRenderLoading();

  try {
    const vault = el("vaultSelect").value;
    const params = new URLSearchParams({ vault });
    if (folder_id) params.set("folder_id", folder_id);
    const res = await fetch(`${API}/contents?${params}`);
    const data = await res.json();

    if (data.ordered_items && data.ordered_items.length) {
      const folders = data.ordered_items.filter(i => i.item_type === "folder");
      const bookmarks = data.ordered_items.filter(i => i.item_type === "bookmark");
      expRenderContents(folders, bookmarks);
    } else {
      expRenderContents(data.subfolders || [], data.bookmarks || []);
    }
  } catch {
    expRenderError();
  }
}

function expGoBack() {
  if (expStack.length <= 1) return;
  expStack.pop();
  const top = expStack[expStack.length - 1];
  expNavigateTo(top.id, top.name);
}

async function expDoSearch(scope) {
  const q = el("expSearchInput").value.trim();
  if (!q) return;

  expSearchMode = true;
  expRenderSearchBtns(true, scope);
  expRenderLoading();

  try {
    const vault = el("vaultSelect").value;
    const params = new URLSearchParams({ q, vault, limit: 50 });

    if (scope === "local") {
      const curId = expStack[expStack.length - 1].id;
      if (curId) params.set("folder_id", curId);
    }

    const res = await fetch(`${API}/search?${params}`);
    const data = await res.json();
    expRenderSearchResults(data.results || [], q, scope);
  } catch {
    expRenderError();
  }
}

// ── Render helpers ─────────────────────────────────────────────────────────

function expRenderBreadcrumb() {
  const bar = el("expBreadcrumb");
  bar.innerHTML = "";
  expStack.forEach((crumb, i) => {
    const isLast = i === expStack.length - 1;
    const span = document.createElement("span");
    span.className = `fnav-crumb${isLast ? " current" : ""}`;
    span.textContent = i === 0 ? "📂 Root" : `📁 ${crumb.name}`;
    if (!isLast) span.addEventListener("click", () => {
      expStack = expStack.slice(0, i + 1);
      expNavigateTo(crumb.id, crumb.name);
    });
    bar.appendChild(span);
    if (!isLast) {
      const sep = document.createElement("span");
      sep.className = "fnav-sep"; sep.textContent = " › ";
      bar.appendChild(sep);
    }
  });
  bar.scrollLeft = bar.scrollWidth;
}

function expRenderSearchBtns(searching, activeScope) {
  el("btnSearchLocal").classList.toggle("active-scope", searching && activeScope === "local");
  el("btnSearchGlobal").classList.toggle("active-scope", searching && activeScope === "global");
}

function expRenderLoading() {
  el("expContents").innerHTML =
    `<div class="exp-empty"><div class="empty-icon">⏳</div>Loading…</div>`;
}

function expRenderError() {
  el("expContents").innerHTML =
    `<div class="exp-empty"><div class="empty-icon">⚠️</div>Could not load</div>`;
}

function expRenderContents(folders, bookmarks) {
  const wrap = el("expContents");
  wrap.innerHTML = "";

  if (!folders.length && !bookmarks.length) {
    wrap.innerHTML = `<div class="exp-empty"><div class="empty-icon">📂</div>This folder is empty</div>`;
    return;
  }

  for (const f of folders) {
    wrap.appendChild(expMakeFolderRow(f));
  }
  for (const bm of bookmarks) {
    wrap.appendChild(expMakeBookmarkRow(bm));
  }
}

function expRenderSearchResults(results, q, scope) {
  const wrap = el("expContents");
  wrap.innerHTML = "";

  const hdr = document.createElement("div");
  hdr.className = "exp-search-hdr";
  const scopeLabel = scope === "local"
    ? `📁 ${expStack[expStack.length - 1].name || "Root"} & subfolders`
    : "🌐 All vaults";
  hdr.innerHTML = `<span class="exp-search-scope">${scopeLabel}</span>
    <span class="exp-search-count">${results.length} result${results.length !== 1 ? "s" : ""}</span>`;
  wrap.appendChild(hdr);

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "exp-empty";
    empty.innerHTML = `<div class="empty-icon">🔍</div>No results for "${escHtml(q)}"`;
    wrap.appendChild(empty);
    return;
  }

  for (const bm of results) {
    wrap.appendChild(expMakeBookmarkRow(bm, true));
  }
}

function expMakeFolderRow(f) {
  const row = document.createElement("div");
  row.className = "exp-row exp-folder";

  const icon = document.createElement("span");
  icon.className = "exp-row-icon"; icon.textContent = "📁";

  const info = document.createElement("div");
  info.className = "exp-row-info";

  const name = document.createElement("div");
  name.className = "exp-row-name"; name.textContent = f.name;

  const meta = document.createElement("div");
  meta.className = "exp-row-meta";

  // Build count string from API-provided counts
  const parts = [];
  const sf = f.subfolder_count || 0;
  const bm = f.bookmark_count || 0;
  if (sf) parts.push(`${sf} folder${sf !== 1 ? "s" : ""}`);
  if (bm) parts.push(`${bm} bookmark${bm !== 1 ? "s" : ""}`);
  meta.textContent = parts.length ? parts.join(" · ") : "Empty";

  info.append(name, meta);

  const arrow = document.createElement("span");
  arrow.className = "exp-row-arrow"; arrow.textContent = "›";

  row.append(icon, info, arrow);
  row.addEventListener("click", () => expNavigateTo(f.id, f.name));
  return row;
}

function expMakeBookmarkRow(bm, showFolder = false) {
  const row = document.createElement("div");
  row.className = "exp-row exp-bookmark";

  // 1. Thumbnail (Falls back to favicon if no screenshot)
  const thumb = document.createElement("div");
  thumb.className = "exp-thumb";
  if (bm.screenshot) {
    const img = document.createElement("img");
    img.src = `${API}/static/archive/${bm.id}.jpeg`;
    img.onerror = () => {
      thumb.innerHTML = "";
      appendFaviconOrIcon(thumb, bm);
    };
    thumb.appendChild(img);
  } else {
    appendFaviconOrIcon(thumb, bm);
  }

  const info = document.createElement("div");
  info.className = "exp-row-info";

  const title = document.createElement("div");
  title.className = "exp-row-name"; title.textContent = bm.title || bm.url;

  // 2. Build the URL row with the tiny Favicon injected next to it
  const url = document.createElement("div");
  url.className = "exp-row-url";
  url.style.cssText = "display:flex;align-items:center;gap:6px;";

  let favHtml = `<span style="font-size:11px;opacity:0.7">🌐</span>`;
  if (bm.favicon_path) {
    favHtml = `<img src="${API}/static/favicons/${bm.id}.ico" style="width:12px;height:12px;object-fit:contain;border-radius:2px;" onerror="this.style.display='none'">`;
  } else if (bm.favicon_url) {
    favHtml = `<img src="${escHtml(bm.favicon_url)}" style="width:12px;height:12px;object-fit:contain;border-radius:2px;" onerror="this.style.display='none'">`;
  }

  url.innerHTML = `${favHtml}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(bm.url)}</span>`;

  const badges = document.createElement("div");
  badges.className = "exp-row-badges";

  if (showFolder && bm.folder_name) {
    const fb = document.createElement("span");
    fb.className = "badge folder"; fb.textContent = `📁 ${bm.folder_name}`;
    badges.appendChild(fb);
  }

  (bm.tags || []).slice(0, 3).forEach(t => {
    const tb = document.createElement("span");
    tb.className = "badge tag"; tb.textContent = t;
    badges.appendChild(tb);
  });

  info.append(title, url, badges);
  row.append(thumb, info);
  row.addEventListener("click", () => chrome.tabs.create({ url: bm.url }));
  return row;
}

// Show local favicon if available, fallback to external URL, then fallback to 🔖 text
function appendFaviconOrIcon(container, bm) {
  if (bm.favicon_path || bm.favicon_url) {
    const img = document.createElement("img");
    // Try the locally archived icon first, otherwise use the live web URL
    img.src = bm.favicon_path ? `${API}/static/favicons/${bm.id}.ico` : bm.favicon_url;
    img.style.cssText = "width:20px;height:20px;object-fit:contain;border-radius:3px";

    img.onerror = () => {
      // If the local file failed but we have a live URL, try the live URL
      if (bm.favicon_path && bm.favicon_url && !img.src.includes(bm.favicon_url)) {
        img.src = bm.favicon_url;
      } else {
        // If everything fails, show the default text icon
        container.innerHTML = "";
        container.textContent = "🔖";
      }
    };
    container.appendChild(img);
  } else {
    container.textContent = "🔖";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS CHIP
// ═══════════════════════════════════════════════════════════════════════════
function updateStatusChip(state) {
  const chip = el("statusChip");
  chip.className = `status-chip ${state}`;
  const labels = { unsaved: "Not Saved", saved: "✓ Saved", archived: "📦 Archived", error: "Error", loading: "…" };
  chip.textContent = labels[state] || state;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOGGLES
// ═══════════════════════════════════════════════════════════════════════════
["toggleScreenshot", "toggleArchive"].forEach(id => {
  el(id).addEventListener("click", e => {
    const chk = el(id).querySelector("input");
    if (e.target === chk) return;
    chk.checked = !chk.checked;
    syncToggle(id, chk.id);
  });
});
function syncToggle(labelId, chkId) {
  el(labelId).classList.toggle("on", el(chkId).checked);
}
el("chkScreenshot").addEventListener("change", () => syncToggle("toggleScreenshot", "chkScreenshot"));
el("chkArchive").addEventListener("change", () => syncToggle("toggleArchive", "chkArchive"));

// ═══════════════════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════════════════
el("btnSave").addEventListener("click", async () => {
  el("btnSave").disabled = true;
  el("btnSave").textContent = "Saving…";
  updateStatusChip("loading");

  const tags = el("tagsInput").value.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  const folder_id = fnavSelected?.id || null;

  try {
    const res = await chrome.runtime.sendMessage({
      type: "SAVE", tabId: currentTab.id, url: currentTab.url, title: currentTab.title,
      vault: el("vaultSelect").value, tags, archive: el("chkArchive").checked,
      notes: el("notesInput").value, folder_id,
      favicon_url: currentTab.favIconUrl // <--- ADD THIS LINE
    });

    if (res.success) {
      bookmarkId = res.id;
      isSaved = true;
      el("btnSave").textContent = "Update Bookmark";
      el("btnDelete").style.display = "inline-block";
      el("dupWarning").classList.add("show");
      updateStatusChip(el("chkArchive").checked ? "archived" : "saved");
      toast("✓ Bookmark saved");
      await saveLastFolder();
    } else {
      throw new Error(res.error || "Unknown error");
    }
  } catch (e) {
    updateStatusChip("error");
    toast("❌ Save failed: " + e.message);
  } finally {
    el("btnSave").disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════════════════
el("btnDelete").addEventListener("click", async () => {
  if (!bookmarkId) return;
  if (!confirm("Delete this bookmark?")) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: "DELETE", id: bookmarkId, tabId: currentTab.id });
    if (res.success) {
      bookmarkId = null; isSaved = false; fnavSelected = null;
      fnavRenderDestination(); fnavRenderList();
      el("btnSave").textContent = "Save Bookmark";
      el("btnDelete").style.display = "none";
      el("dupWarning").classList.remove("show");
      el("tagsInput").value = ""; el("notesInput").value = "";
      updateStatusChip("unsaved");
      toast("🗑 Bookmark deleted");
    }
  } catch (e) { toast("❌ Delete failed: " + e.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════
function toast(msg, dur = 2000) {
  const t = el("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), dur);
}
function el(id) { return document.getElementById(id); }
function escHtml(str = "") {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Boot ──────────────────────────────────────────────────────────────────
init();