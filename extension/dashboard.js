// dashboard.js — PowerBookmark Dashboard v1.7
"use strict";
const API = "http://127.0.0.1:8765";

let allBookmarks = [];
let vaults = [];
let currentFilter = { type: "all", value: null };
let currentView = "grid";
let currentSort = "date-desc";
let searchTimer = null;
let searchQuery = "";

// folder state
let folderMap = {};   // id → { id, name, parent_id, vault, depth }
let folderCollapsed = {};

// ordered items cache: folder_id (or "__root__") → ordered_items array
// Used only in list view to render the interleaved sorted list.
let orderedItemsCache = {};
let activePrimaryView = localStorage.getItem("pb_sidebar_primary") || "folders"; // 'browse', 'vaults', 'folders'
let activeTagsView = localStorage.getItem("pb_sidebar_tags") === "true"; // true or false


// selection state — bookmarks AND subfolders
let selectedIds = new Set();
let selectedFolderIds = new Set();
let lastClickedIdx = -1;

// drag state — folder-move drag (existing behavior)
let dragIds = new Set();
let dragFolderIds = new Set();
let targetFetchIds = [];

// reorder drag state (list-view grip handle drag)
let reorderDrag = {
  active: false,
  itemId: null,
  itemType: null,      // 'bookmark' | 'folder'
  sourceEl: null,
  indicatorEl: null,   // the blue line element
  overItemId: null,
  overItemType: null,
  overPosition: null,  // 'before' | 'after'
};

// sidebar section collapse state
const sectionCollapsed = { vaults: false, folders: false, tags: false };

// folder picker callback
let folderPickerMode = null;
let folderPickerSelId = null;

// ── Custom drag ghost ─────────────────────────────────────────────────────────
let ghostEl = null;

function createDragGhost(bmIds, folderIds) {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }

  const totalCount = bmIds.size + folderIds.size;
  const bmCount = bmIds.size;
  const folCount = folderIds.size;

  let label = "";
  if (bmCount && folCount) label = `${bmCount} bookmark${bmCount > 1 ? "s" : ""} + ${folCount} folder${folCount > 1 ? "s" : ""}`;
  else if (folCount) label = `${folCount} folder${folCount > 1 ? "s" : ""}`;
  else {
    const firstId = [...bmIds][0];
    const bm = allBookmarks.find(b => b.id === firstId);
    label = bm ? (bm.title || bm.url).slice(0, 32) : `${bmCount} bookmark${bmCount > 1 ? "s" : ""}`;
    if (bmCount > 1) label += ` +${bmCount - 1}`;
  }

  let thumbHtml = "";
  if (bmCount) {
    const firstId = [...bmIds][0];
    const bm = allBookmarks.find(b => b.id === firstId);
    if (bm && bm.screenshot) {
      thumbHtml = `<img src="${API}/static/archive/${bm.id}.jpeg"
        style="width:32px;height:22px;object-fit:cover;border-radius:3px;flex-shrink:0"
        onerror="this.style.display='none'">`;
    } else {
      thumbHtml = `<span style="font-size:14px;flex-shrink:0">${folCount ? "📁" : "🔖"}</span>`;
    }
  } else {
    thumbHtml = `<span style="font-size:14px;flex-shrink:0">📁</span>`;
  }

  const badge = totalCount > 1
    ? `<span style="
        background:var(--blue);color:#fff;border-radius:99px;
        font-size:10px;font-weight:700;padding:1px 5px;
        position:absolute;top:-6px;right:-6px;line-height:1.4;
        font-family:'JetBrains Mono',monospace;">${totalCount}</span>`
    : "";

  ghostEl = document.createElement("div");
  ghostEl.id = "drag-ghost";
  ghostEl.style.cssText = `
    position:fixed;
    top:-200px;left:-200px;
    z-index:9999;
    pointer-events:none;
    display:flex;
    align-items:center;
    gap:7px;
    background:var(--bg3);
    border:1px solid var(--blue);
    border-radius:8px;
    padding:6px 10px 6px 7px;
    box-shadow:0 4px 20px rgba(0,0,0,0.5);
    max-width:220px;
    font-family:'Inter',system-ui,sans-serif;
  `;
  ghostEl.innerHTML = `
    <div style="position:relative;display:flex;align-items:center">
      ${thumbHtml}
      ${badge}
    </div>
    <span style="font-size:12px;font-weight:500;color:var(--text);
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                 max-width:160px;">${escHtml(label)}</span>
  `;
  document.body.appendChild(ghostEl);
  return ghostEl;
}

function moveDragGhost(e) {
  if (!ghostEl) return;
  ghostEl.style.top = (e.clientY + 14) + "px";
  ghostEl.style.left = (e.clientX + 14) + "px";
}

function removeDragGhost() {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

// ── Reorder drop indicator (blue line) ───────────────────────────────────────
function getOrCreateIndicator() {
  const container = document.getElementById("bookmarksContainer");
  let el = document.getElementById("reorder-indicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "reorder-indicator";
    el.style.cssText = `
      position: absolute;
      left: 0; right: 0;
      height: 2px;
      background: var(--blue);
      border-radius: 2px;
      pointer-events: none;
      z-index: 50;
      box-shadow: 0 0 6px rgba(59,130,246,0.6);
      display: none;
    `;
    container.appendChild(el);
  }
  reorderDrag.indicatorEl = el;
  return el;
}


function showIndicator(referenceEl, position) {
  const indicator = getOrCreateIndicator();
  const container = document.getElementById("bookmarksContainer");
  const containerRect = container.getBoundingClientRect();
  const refRect = referenceEl.getBoundingClientRect();

  const top = position === "before"
    ? refRect.top - containerRect.top + container.scrollTop - 1
    : refRect.bottom - containerRect.top + container.scrollTop - 1;

  indicator.style.top = top + "px";
  indicator.style.display = "block";
}

function hideIndicator() {
  if (reorderDrag.indicatorEl) {
    reorderDrag.indicatorEl.style.display = "none";
  }
}

// ── Ordered items cache helpers ───────────────────────────────────────────────
function getCacheKey(filter) {
  if (filter.type === "folder") return filter.value || "__root__";
  return "__root__";
}

function getOrderedItemsForCurrentView() {
  if (currentFilter.type !== "folder" && currentFilter.type !== "all") return null;
  const key = getCacheKey(currentFilter);
  return orderedItemsCache[key] || null;
}

function setOrderedItemsCache(folderId, items) {
  const key = folderId || "__root__";
  orderedItemsCache[key] = items;
}

async function fetchOrderedContents(folderId, vault) {
  const params = new URLSearchParams({ vault: vault || "default" });
  if (folderId) params.set("folder_id", folderId);
  try {
    const res = await fetch(`${API}/contents?${params}`);
    const data = await res.json();
    if (data.ordered_items) {
      setOrderedItemsCache(folderId, data.ordered_items);
    }
    return data;
  } catch {
    return null;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  await Promise.all([loadVaults(), loadAll()]);
  renderSidebar();
  bindStaticControls();
  bindSidebarCollapse();
  document.addEventListener("dragover", moveDragGhost);
}

async function loadAll() {
  showLoading();
  try {
    const res = await fetch(`${API}/recent?limit=500`);
    const data = await res.json();
    allBookmarks = data.bookmarks || [];
    updateStats();
    render();
  } catch { showError(); }
}

async function loadVaults() {
  try {
    const res = await fetch(`${API}/vaults`);
    const data = await res.json();
    vaults = data.vaults || [];
  } catch { }
}

// ── Collapsible sidebar sections ──────────────────────────────────────────────
function bindSidebarCollapse() {
  document.querySelectorAll("[data-toggle-section]").forEach(header => {
    header.addEventListener("click", () => {
      const key = header.dataset.toggleSection;
      sectionCollapsed[key] = !sectionCollapsed[key];
      applySectionCollapse(key);
    });
  });
}

function applySectionCollapse(key) {
  const bodyMap = { vaults: "bodyVaults", folders: "bodyFolders", tags: "bodyTags" };
  const chevronMap = { vaults: "chevronVaults", folders: "chevronFolders", tags: "chevronTags" };
  const sectionMap = { vaults: "sectionVaults", folders: "sectionFolders", tags: "sectionTags" };

  const body = document.getElementById(bodyMap[key]);
  const chevron = document.getElementById(chevronMap[key]);
  const section = document.getElementById(sectionMap[key]);
  if (!body || !chevron || !section) return;

  const collapsed = sectionCollapsed[key];
  body.classList.toggle("collapsed", collapsed);
  chevron.classList.toggle("open", !collapsed);
  section.classList.toggle("expanded", !collapsed);
}

// ── Static control bindings ───────────────────────────────────────────────────
function bindStaticControls() {
  bindSidebarToggles();
  document.querySelectorAll(".sort-btn").forEach(btn => {
    if (!btn.dataset.sort) return; // skip + Folder / + Bookmark buttons
    btn.addEventListener("click", () => {
      currentSort = btn.dataset.sort;
      document.querySelectorAll(".sort-btn[data-sort]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });

  document.getElementById("selectAllBtn").addEventListener("click", () => {
    const visible = getFiltered();
    const visibleFolders = getVisibleSubfolders();
    const allBmSel = visible.every(b => selectedIds.has(b.id));
    const allFolSel = visibleFolders.every(f => selectedFolderIds.has(f.id));

    if (allBmSel && allFolSel && (visible.length + visibleFolders.length) > 0) {
      clearSelection();
    } else {
      visible.forEach(b => selectedIds.add(b.id));
      visibleFolders.forEach(f => selectedFolderIds.add(f.id));
      updateBulkBar();
      render();
    }
  });

  document.getElementById("viewGrid").addEventListener("click", () => {
  currentView = "grid";
  document.getElementById("viewGrid").classList.add("active");
  document.getElementById("viewList").classList.remove("active");
  document.querySelectorAll(".sort-btn[data-sort]").forEach(b => {
    b.style.opacity = "";
    b.style.pointerEvents = "";
  });
  render();
});

function bindSidebarToggles() {
  const toggles = document.querySelectorAll('.sb-toggle');
  
  // Initial render based on loaded state
  applySidebarView();

  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const view = toggle.dataset.sbView;

      if (view === "tags") {
        // Tags is an independent toggle
        activeTagsView = !activeTagsView;
        localStorage.setItem("pb_sidebar_tags", activeTagsView);
      } else {
        // Browse, Vaults, and Folders are mutually exclusive primary views
        activePrimaryView = view;
        localStorage.setItem("pb_sidebar_primary", activePrimaryView);
        
        // If switching to folders, ensure we are in a folder or all view
        if (view === "folders" && currentFilter.type === "vault") {
            currentFilter = { type: "all", value: null };
            document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i => i.classList.remove("active"));
            document.querySelector('.sidebar-item[data-filter="all"]')?.classList.add("active");
            render();
        }
      }
      applySidebarView();
    });
  });
}

function applySidebarView() {
  // 1. Update button styling
  document.querySelectorAll('.sb-toggle').forEach(toggle => {
    const view = toggle.dataset.sbView;
    if (view === "tags") {
      toggle.classList.toggle("active", activeTagsView);
    } else {
      toggle.classList.toggle("active", view === activePrimaryView);
    }
  });

  // 2. Show/Hide actual sidebar sections
  // We use .style.display to fully remove them from the flow when hidden
  const sections = {
    browse: document.getElementById("sectionBrowse"),
    vaults: document.getElementById("sectionVaults"),
    folders: document.getElementById("sectionFolders"),
    tags: document.getElementById("sectionTags")
  };

  if (sections.browse)  sections.browse.style.display  = (activePrimaryView === "browse") ? "flex" : "none";
  if (sections.vaults)  sections.vaults.style.display  = (activePrimaryView === "vaults") ? "flex" : "none";
  if (sections.folders) sections.folders.style.display = (activePrimaryView === "folders") ? "flex" : "none";
  if (sections.tags)    sections.tags.style.display    = activeTagsView ? "flex" : "none";
  
  // Hide the divider lines if the sections they follow are hidden
  // This is a quick cleanup so we don't get stacked empty lines
  const dividers = document.querySelectorAll(".sidebar-divider");
  if (dividers.length >= 3) {
      dividers[0].style.display = (activePrimaryView === "browse") ? "block" : "none";
      dividers[1].style.display = (activePrimaryView === "vaults") ? "block" : "none";
      dividers[2].style.display = (activePrimaryView === "folders" && activeTagsView) ? "block" : "none";
  }
}


document.getElementById("viewList").addEventListener("click", async () => {
  currentView = "list";
  document.getElementById("viewList").classList.add("active");
  document.getElementById("viewGrid").classList.remove("active");
  document.querySelectorAll(".sort-btn[data-sort]").forEach(b => {
    b.style.opacity = "0.35";
    b.style.pointerEvents = "none";
  });
  await ensureOrderedItems();
  render();
});

  document.getElementById("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchQuery = e.target.value.trim();
    searchTimer = setTimeout(render, 200);
  });

  document.getElementById("bulkDesel").addEventListener("click", clearSelection);
  document.getElementById("bulkMove").addEventListener("click", () => openFolderPicker("move"));
  document.getElementById("bulkCopy").addEventListener("click", () => openFolderPicker("copy"));
  document.getElementById("bulkTag").addEventListener("click", openBulkTagModal);

  document.getElementById("bulkFetch").addEventListener("click", () => {
    targetFetchIds = [...selectedIds];
    document.getElementById("bulkFetchArchiveCheck").checked = false;
    document.getElementById("bulkFetchTitle").textContent = `Bulk Fetch (${targetFetchIds.length})`;
    document.getElementById("bulkFetchOverlay").classList.add("open");
  });

  document.getElementById("bulkFetchClose").addEventListener("click", () => {
    document.getElementById("bulkFetchOverlay").classList.remove("open");
  });
  document.getElementById("bulkFetchCancel").addEventListener("click", () => {
    document.getElementById("bulkFetchOverlay").classList.remove("open");
  });

  document.getElementById("bulkFetchConfirm").addEventListener("click", executeBulkFetch);
  document.getElementById("bulkDelete").addEventListener("click", bulkDeleteSelected);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
      closeDetail();
      closeFolderPicker();
      closeBulkTagModal();
      closeNewFolderModal();
      closeNewBookmarkModal();
    }
  });

  document.getElementById("previewClose").addEventListener("click", closePreview);
  document.getElementById("previewOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("previewOverlay")) closePreview();
  });

  document.getElementById("detailClose").addEventListener("click", closeDetail);
  document.getElementById("detailBackdrop").addEventListener("click", closeDetail);

  document.getElementById("bookmarksContainer").addEventListener("click", (e) => {
    const badge = e.target.closest("[data-filter-folder]");
    if (!badge) return;
    e.stopPropagation();
    setFolderFilter(badge.dataset.filterFolder);
  });

  document.getElementById("folderPickerClose").addEventListener("click", closeFolderPicker);
  document.getElementById("folderPickerCancel").addEventListener("click", closeFolderPicker);
  document.getElementById("folderPickerConfirm").addEventListener("click", confirmFolderPick);

  document.getElementById("bulkTagClose").addEventListener("click", closeBulkTagModal);
  document.getElementById("bulkTagCancel").addEventListener("click", closeBulkTagModal);
  document.getElementById("bulkTagConfirm").addEventListener("click", applyBulkTag);

  document.getElementById("newFolderBtnMain").addEventListener("click", openNewFolderModal);
  document.getElementById("newFolderBtnSidebar").addEventListener("click", openNewFolderModal);
  document.getElementById("newFolderClose").addEventListener("click", closeNewFolderModal);
  document.getElementById("newFolderCancel").addEventListener("click", closeNewFolderModal);
  document.getElementById("newFolderConfirm").addEventListener("click", confirmNewFolder);
  document.getElementById("newFolderName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmNewFolder();
    if (e.key === "Escape") closeNewFolderModal();
  });

  document.getElementById("newBookmarkBtnMain").addEventListener("click", openNewBookmarkModal);
  document.getElementById("newBookmarkBtnSidebar").addEventListener("click", openNewBookmarkModal);
  document.getElementById("newBookmarkClose").addEventListener("click", closeNewBookmarkModal);
  document.getElementById("newBookmarkCancel").addEventListener("click", closeNewBookmarkModal);
  document.getElementById("newBookmarkConfirm").addEventListener("click", confirmNewBookmark);
  document.getElementById("newBookmarkFetchBtn").addEventListener("click", fetchBookmarkMeta);
  document.getElementById("newBookmarkUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchBookmarkMeta();
  });
}

// ── Ensure ordered items are loaded for list view ─────────────────────────────
async function ensureOrderedItems() {
  if (currentView !== "list") return;
  if (searchQuery) return; // search results don't use order

  const folderId = currentFilter.type === "folder" ? currentFilter.value : null;
  const vault = currentFilter.type === "vault"
    ? currentFilter.value
    : (vaults[0]?.name || "default");

  // Only fetch if we're in a folder or root context
  if (currentFilter.type !== "folder" && currentFilter.type !== "all") return;

  await fetchOrderedContents(folderId, vault);
}

// ── Folder tree helpers ───────────────────────────────────────────────────────
async function fetchFolderTree(vault) {
  const all = [];
  const queue = [{ folder_id: null, depth: 0 }];
  while (queue.length) {
    const { folder_id, depth } = queue.shift();
    const params = new URLSearchParams({ vault });
    if (folder_id) params.set("folder_id", folder_id);
    try {
      const res = await fetch(`${API}/contents?${params}`);
      const data = await res.json();
      for (const f of (data.subfolders || [])) {
        all.push({ ...f, depth });
        queue.push({ folder_id: f.id, depth: depth + 1 });
      }
    } catch { break; }
  }
  return all;
}

function buildFolderMap(folders, vault) {
  for (const f of folders) folderMap[f.id] = { ...f, vault };
}

function folderName(id) {
  return id && folderMap[id] ? folderMap[id].name : "";
}

function descendantIds(folderId) {
  const result = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of Object.values(folderMap)) {
      if (!result.has(f.id) && result.has(f.parent_id)) {
        result.add(f.id);
        changed = true;
      }
    }
  }
  return result;
}

function flatFolderList() {
  const roots = Object.values(folderMap).filter(f => !f.parent_id);
  const result = [];
  function walk(f, depth) {
    result.push({ ...f, depth });
    Object.values(folderMap)
      .filter(c => c.parent_id === f.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => walk(c, depth + 1));
  }
  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => walk(r, 0));
  return result;
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function getFolderAncestors(folderId) {
  const chain = [];
  let current = folderMap[folderId];
  const seen = new Set();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? folderMap[current.parent_id] : null;
  }
  return chain;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const total = allBookmarks.length;
  const archived = allBookmarks.filter(b => b.archived).length;
  const screenshot = allBookmarks.filter(b => b.screenshot).length;
  document.getElementById("totalCount").textContent = total;
  document.getElementById("countAll").textContent = total;
  document.getElementById("countArchived").textContent = archived;
  document.getElementById("countScreenshot").textContent = screenshot;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
async function renderSidebar() {
  const vaultList = document.getElementById("vaultList");
  vaultList.innerHTML = vaults.map(v => `
    <div class="sidebar-item" data-filter="vault" data-value="${escAttr(v.name)}">
      <span class="item-icon">📁</span>
      <span class="item-name">${escHtml(v.name)}</span>
      <span class="item-count">${v.count}</span>
    </div>
  `).join("") || `<div class="sidebar-empty">No vaults yet</div>`;

  const tagCounts = {};
  allBookmarks.forEach(b => (b.tags || []).forEach(t => {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const tagList = document.getElementById("tagList");
  tagList.innerHTML = topTags.map(([tag, count]) => `
    <div class="sidebar-item" data-filter="tag" data-value="${escAttr(tag)}">
      <span class="item-icon">#</span>
      <span class="item-name">${escHtml(tag)}</span>
      <span class="item-count">${count}</span>
    </div>
  `).join("") || `<div class="sidebar-empty">No tags yet</div>`;

  await renderFolderSidebar();
  bindSidebarClicks();
  bindSidebarDragTargets();

  ["vaults", "folders", "tags"].forEach(applySectionCollapse);
}

async function renderFolderSidebar() {
  const container = document.getElementById("folderSidebarSection");
  if (!container) return;

  const targetVaults = (currentFilter.type === "vault")
    ? [currentFilter.value]
    : vaults.map(v => v.name);

  if (!targetVaults.length) {
    container.innerHTML = `<div class="sidebar-empty">No folders yet</div>`;
    return;
  }
  container.innerHTML = `<div class="sidebar-empty">Loading…</div>`;

  folderMap = {};
  let allFolders = [];
  for (const vault of targetVaults) {
    const tree = await fetchFolderTree(vault);
    buildFolderMap(tree, vault);
    allFolders = allFolders.concat(tree.map(f => ({ ...f, vault })));
  }

  if (!allFolders.length) {
    container.innerHTML = `<div class="sidebar-empty">No folders yet</div>`;
    return;
  }

  const directCounts = {};
  allBookmarks.forEach(b => {
    if (b.folder_id) directCounts[b.folder_id] = (directCounts[b.folder_id] || 0) + 1;
  });
  function totalCount(fid) {
    let n = 0;
    for (const id of descendantIds(fid)) n += directCounts[id] || 0;
    return n;
  }

  allFolders.forEach(f => {
    if (folderCollapsed[f.id] === undefined) folderCollapsed[f.id] = true;
  });

  const children = {};
  allFolders.forEach(f => {
    const pid = f.parent_id || "__root__";
    (children[pid] = children[pid] || []).push(f);
  });

  function renderFolderTree(parentId, depth) {
    const kids = children[parentId || "__root__"] || [];
    return kids.map(f => {
      const hasKids = !!(children[f.id] && children[f.id].length);
      const collapsed = !!folderCollapsed[f.id];
      const isActive = currentFilter.type === "folder" && currentFilter.value === f.id;
      const count = totalCount(f.id);
      const indent = depth * 14;

      const chevron = hasKids
        ? `<span class="folder-chevron${collapsed ? "" : " open"}" data-toggle-folder="${escAttr(f.id)}">▶</span>`
        : `<span class="folder-chevron-spacer"></span>`;

      const childHtml = (hasKids && !collapsed) ? renderFolderTree(f.id, depth + 1) : "";

      return `
        <div class="folder-tree-row${isActive ? " active" : ""}"
             data-filter="folder" data-value="${escAttr(f.id)}"
             data-drop-folder="${escAttr(f.id)}"
             data-sidebar-folder="${escAttr(f.id)}"
             draggable="true"
             style="padding-left:${10 + indent}px">
          ${chevron}
          <span class="item-icon">📁</span>
          <span class="item-name">${escHtml(f.name)}</span>
          <span class="item-count">${count}</span>
        </div>
        ${childHtml}`;
    }).join("");
  }

  container.innerHTML = renderFolderTree(null, 0) ||
    `<div class="sidebar-empty">No folders yet</div>`;

  container.querySelectorAll("[data-toggle-folder]").forEach(chevron => {
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      const fid = chevron.dataset.toggleFolder;
      folderCollapsed[fid] = !folderCollapsed[fid];
      renderFolderSidebar().then(() => { bindSidebarClicks(); bindSidebarDragTargets(); });
    });
  });
}

function bindSidebarClicks() {
  document.querySelectorAll(".sidebar-item").forEach(item => {
    item.addEventListener("click", async () => {
      document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      currentFilter = { type: item.dataset.filter, value: item.dataset.value || null };
      searchQuery = "";
      document.getElementById("searchInput").value = "";
      clearSelection();
      if (currentFilter.type === "vault") {
        await renderFolderSidebar();
        bindSidebarClicks();
        bindSidebarDragTargets();
      }
      if (currentView === "list") await ensureOrderedItems();
      render();
    });
  });

  document.querySelectorAll(".folder-tree-row").forEach(row => {
    row.addEventListener("click", async (e) => {
      if (e.target.closest("[data-toggle-folder]")) return;
      document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i => i.classList.remove("active"));
      row.classList.add("active");
      currentFilter = { type: "folder", value: row.dataset.value };
      searchQuery = "";
      document.getElementById("searchInput").value = "";
      clearSelection();
      if (currentView === "list") await ensureOrderedItems();
      render();
    });
  });
}

// ── Sidebar drag-drop targets ─────────────────────────────────────────────────
function bindSidebarDragTargets() {
  document.querySelectorAll("[data-drop-folder]").forEach(el => {
    el.addEventListener("dragover", (e) => {
      if (!dragIds.size && !dragFolderIds.size && !dragSidebarFolderId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const targetFid = el.dataset.dropFolder;

      if (dragSidebarFolderId) {
        if (dragSidebarFolderId !== targetFid) {
          await executeMoveFolder(dragSidebarFolderId, targetFid);
        }
        dragSidebarFolderId = null;
        removeDragGhost();
        return;
      }

      const bmIds = [...dragIds];
      const folIds = [...dragFolderIds];
      dragIds.clear();
      dragFolderIds.clear();

      if (bmIds.length) await executeBulkMove(bmIds, targetFid);
      if (folIds.length) await executeBulkMoveFolders(folIds, targetFid);

      removeDragGhost();
    });

    el.addEventListener("dragstart", (e) => {
      const sfid = el.dataset.sidebarFolder;
      if (!sfid) return;
      if (e.target.closest("[data-toggle-folder]")) { e.preventDefault(); return; }

      dragSidebarFolderId = sfid;
      dragIds.clear();
      dragFolderIds.clear();

      createDragGhost(new Set(), new Set([sfid]));
      const blank = new Image();
      blank.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      e.dataTransfer.setDragImage(blank, 0, 0);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sfid);

      requestAnimationFrame(() => el.classList.add("dragging"));
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      dragSidebarFolderId = null;
      removeDragGhost();
    });
  });

  const sidebarFolderBody = document.getElementById("bodyFolders");
  if (sidebarFolderBody) {
    sidebarFolderBody.addEventListener("dragover", (e) => {
      if (!dragSidebarFolderId) return;
      e.preventDefault();
    });
  }
}

let dragSidebarFolderId = null;

// ── Execute single folder move ────────────────────────────────────────────────
async function executeMoveFolder(folderId, newParentId) {
  const desc = descendantIds(folderId);
  if (desc.has(newParentId)) {
    toast("❌ Can't move a folder into itself");
    return;
  }
  try {
    const res = await fetch(`${API}/folders/${folderId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: newParentId }),
    });
    if (!res.ok) throw new Error();
    if (folderMap[folderId]) folderMap[folderId].parent_id = newParentId;

    // ── ADD THESE 4 LINES ──
    const srcKey = currentFilter.type === "folder" ? currentFilter.value || "__root__" : "__root__";
    if (orderedItemsCache[srcKey]) {
      orderedItemsCache[srcKey] = orderedItemsCache[srcKey].filter(
        i => !((i.id || i.item_id) === folderId && i.item_type === "folder")
      );
    }
    // ──────────────────────

    await renderSidebar();
    render();
    toast(`✦ Folder moved`);
  } catch { toast("❌ Folder move failed"); }
}

// ── Filter + sort + render ────────────────────────────────────────────────────
function getFiltered() {
  let items = [...allBookmarks];

  if (currentFilter.type === "archived") items = items.filter(b => b.archived);
  if (currentFilter.type === "screenshot") items = items.filter(b => b.screenshot);
  if (currentFilter.type === "vault") items = items.filter(b => b.vault === currentFilter.value);
  if (currentFilter.type === "tag") items = items.filter(b => (b.tags || []).includes(currentFilter.value));
  if (currentFilter.type === "folder") items = items.filter(b => b.folder_id === currentFilter.value);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(b =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.url || "").toLowerCase().includes(q) ||
      (b.notes || "").toLowerCase().includes(q) ||
      (b.tags || []).some(t => t.includes(q))
    );
  }

  switch (currentSort) {
    case "date-asc": items.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")); break;
    case "date-desc": items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); break;
    case "title": items.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url)); break;
    case "domain": items.sort((a, b) => hostOf(a.url).localeCompare(hostOf(b.url))); break;
    case "vault": items.sort((a, b) => (a.vault || "").localeCompare(b.vault || "")); break;
  }

  return items;
}

function getVisibleSubfolders() {
  if (currentFilter.type !== "folder" || searchQuery) return [];
  return Object.values(folderMap).filter(f => f.parent_id === currentFilter.value);
}

// ── Breadcrumb HTML ───────────────────────────────────────────────────────────
function renderBreadcrumb() {
  if (currentFilter.type !== "folder" || !currentFilter.value) return "";

  const ancestors = getFolderAncestors(currentFilter.value);

  const parts = [
    `<span class="breadcrumb-seg" data-breadcrumb-root style="cursor:pointer">🗂 Root</span>`
  ];
  ancestors.forEach((f, i) => {
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    if (i < ancestors.length - 1) {
      parts.push(`<span class="breadcrumb-seg breadcrumb-link" data-breadcrumb-folder="${escAttr(f.id)}"
                       style="cursor:pointer">${escHtml(f.name)}</span>`);
    } else {
      parts.push(`<span class="breadcrumb-seg breadcrumb-current">${escHtml(f.name)}</span>`);
    }
  });

  return `<div class="breadcrumb-bar" id="breadcrumbBar">${parts.join("")}</div>`;
}

function bindBreadcrumbClicks() {
  const bar = document.getElementById("breadcrumbBar");
  if (!bar) return;

  bar.querySelector("[data-breadcrumb-root]")?.addEventListener("click", async () => {
    currentFilter = { type: "all", value: null };
    document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i => i.classList.remove("active"));
    document.querySelector('.sidebar-item[data-filter="all"]')?.classList.add("active");
    clearSelection();
    if (currentView === "list") await ensureOrderedItems();
    render();
  });

  bar.querySelectorAll("[data-breadcrumb-folder]").forEach(el => {
    el.addEventListener("click", async () => {
      const fid = el.dataset.breadcrumbFolder;
      await setFolderFilter(fid);
    });
  });
}

// ── render ────────────────────────────────────────────────────────────────────
function render() {
  const items = getFiltered();
  updateMainHeader(items.length);
  const container = document.getElementById("bookmarksContainer");
  container.style.position = "relative"; // needed for absolute indicator positioning

  const breadcrumbHtml = renderBreadcrumb();

  // ── LIST VIEW: use ordered_items from server ──
  if (currentView === "list" && !searchQuery &&
    (currentFilter.type === "folder" || currentFilter.type === "all")) {

    const folderId = currentFilter.type === "folder" ? currentFilter.value : null;
    const cacheKey = folderId || "__root__";
    const orderedItems = orderedItemsCache[cacheKey];

    if (orderedItems) {
      // Merge server order with local allBookmarks (for up-to-date tag/title data)
      const bmLookup = {};
      allBookmarks.forEach(b => { bmLookup[b.id] = b; });

      const resolvedItems = orderedItems
        .map(item => {
          if (item.item_type === "bookmark") {
            const live = bmLookup[item.id || item.item_id];
            if (!live) return null;
            // Filter by current filter constraints
            if (currentFilter.type === "folder" && live.folder_id !== currentFilter.value) return null;
            return { ...live, item_type: "bookmark", position: item.position };
          } else {
            const folder = folderMap[item.id || item.item_id];
            if (!folder) return null;
            return { ...folder, item_type: "folder", position: item.position };
          }
        })
        .filter(Boolean);

      // Add any items not yet in orderedItems (new bookmarks/folders)
      const orderedIds = new Set(orderedItems.map(i => i.id || i.item_id));

      if (currentFilter.type === "folder") {
        allBookmarks
          .filter(b => b.folder_id === currentFilter.value && !orderedIds.has(b.id))
          .forEach(b => resolvedItems.push({ ...b, item_type: "bookmark", position: Infinity }));
        Object.values(folderMap)
          .filter(f => f.parent_id === currentFilter.value && !orderedIds.has(f.id))
          .forEach(f => resolvedItems.push({ ...f, item_type: "folder", position: Infinity }));
      }

      if (!resolvedItems.length) {
        container.innerHTML = breadcrumbHtml + `
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">Nothing here</div>
            <div class="empty-sub">Save a bookmark or create a folder to get started</div>
          </div>`;
        bindBreadcrumbClicks();
        return;
      }

      container.innerHTML = breadcrumbHtml +
        `<div class="bookmarks-list" id="orderedList">${resolvedItems.map((item, idx) => {
          if (item.item_type === "folder") return folderRowHtml(item, idx);
          return rowHtml(item, idx);
        }).join("")}</div>`;

      bindBreadcrumbClicks();
      bindOrderedListInteractions(resolvedItems);
      bindBookmarkRowActions();
      return;
    }
    // If no cache yet, fall through to normal render and trigger a fetch
    fetchOrderedContents(
      currentFilter.type === "folder" ? currentFilter.value : null,
      vaults[0]?.name || "default"
    ).then(() => render());
    return;
  }

  // ── GRID VIEW or search/filtered views ──
  const subfolderCards = getVisibleSubfolders().sort((a, b) => a.name.localeCompare(b.name));

  const subfolderHtml = subfolderCards.length
    ? `<div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;
                    color:var(--text3);margin-bottom:10px">Subfolders</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${subfolderCards.map(f => {
      const isSel = selectedFolderIds.has(f.id);
      return `
              <div class="subfolder-card${isSel ? " selected" : ""}"
                   data-fid="${escAttr(f.id)}" draggable="true">
                <div class="subfolder-checkbox" title="Select folder"></div>
                <span style="font-size:18px;pointer-events:none">📁</span>
                <span style="font-size:13px;font-weight:500;color:var(--text);pointer-events:none"
                      data-nav-folder="${escAttr(f.id)}">${escHtml(f.name)}</span>
              </div>`;
    }).join("")}
        </div>
      </div>`
    : "";

  if (!items.length && !subfolderCards.length) {
    container.innerHTML = breadcrumbHtml + `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Nothing here</div>
        <div class="empty-sub">Try a different filter or search term</div>
      </div>`;
    bindBreadcrumbClicks();
    return;
  }

  let bookmarksHtml = "";
  if (items.length) {
    if (currentView === "grid") {
      bookmarksHtml = `<div class="bookmarks-grid">${items.map((b, i) => cardHtml(b, i)).join("")}</div>`;
    } else {
      bookmarksHtml = `<div class="bookmarks-list">${items.map((b, i) => rowHtml(b, i)).join("")}</div>`;
    }
  }

  container.innerHTML = breadcrumbHtml + subfolderHtml + bookmarksHtml;
  bindBreadcrumbClicks();
  bindSubfolderCards();
  bindBookmarkCards();
  bindBookmarkRowActions();
}

// ── Bind interactions for the ordered interleaved list ────────────────────────
function bindOrderedListInteractions(resolvedItems) {
  const list = document.getElementById("orderedList");
  if (!list) return;

  // Track whether the current drag started from a grip handle
  let dragFromHandle = false;

  // ── Subfolder row interactions ──
  list.querySelectorAll("[data-fid]").forEach(card => {
    const fid = card.dataset.fid;

    card.addEventListener("click", (e) => {
  if (e.target.closest(".action-btn")) return;
  e.preventDefault();
  if (selectedFolderIds.has(fid)) selectedFolderIds.delete(fid);
  else selectedFolderIds.add(fid);
  updateBulkBar();
  render();
});

card.addEventListener("dblclick", async (e) => {
  if (e.target.closest(".action-btn")) return;
  selectedFolderIds.delete(fid);
  updateBulkBar();
  document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i =>
    i.classList.toggle("active", i.dataset.filter === "folder" && i.dataset.value === fid));
  currentFilter = { type: "folder", value: fid };
  clearSelection();
  await ensureOrderedItems();
  render();
});

  });

  // ── Bookmark row click → open detail ──
  list.querySelectorAll("[data-bid]").forEach((el, idx) => {
    el.addEventListener("click", (e) => {
  if (e.target.closest(".action-btn, [data-filter-folder]")) return;
  e.preventDefault();
  handleSelectionClick(el.dataset.bid, idx, e.shiftKey,
    resolvedItems.filter(i => i.item_type === "bookmark"));
});

el.addEventListener("dblclick", (e) => {
  if (e.target.closest(".action-btn, [data-filter-folder]")) return;
  // Double click — deselect and open detail
  selectedIds.delete(el.dataset.bid);
  updateBulkBar();
  const bm = allBookmarks.find(b => b.id === el.dataset.bid);
  if (bm) openDetail(bm);
});
  });

  // ── Drag logic for all rows (both [data-bid] and [data-fid]) ──
  list.querySelectorAll("[data-bid], [data-fid]").forEach(row => {
    row.setAttribute("draggable", "true");

    // Mark drag-from-handle when mousedown fires on the handle
    const handle = row.querySelector(".reorder-handle");
    if (handle) {
      handle.addEventListener("mousedown", () => { dragFromHandle = true; });
    }
    // Clear the flag if mouseup fires without a dragstart (plain click)
    row.addEventListener("mouseup", () => { dragFromHandle = false; });

    row.addEventListener("dragstart", (e) => {
      // Prevent drag from action buttons / checkboxes
      if (e.target.closest(".action-btn, .row-checkbox, .subfolder-checkbox, [data-filter-folder]")) {
        e.preventDefault();
        dragFromHandle = false;
        return;
      }

      if (dragFromHandle) {
        // ── REORDER drag ──
        dragFromHandle = false;
        e.stopPropagation();

        const itemId = row.dataset.bid || row.dataset.fid;
        const itemType = row.dataset.bid ? "bookmark" : "folder";

        reorderDrag.active = true;
        reorderDrag.itemId = itemId;
        reorderDrag.itemType = itemType;
        reorderDrag.sourceEl = row;
        reorderDrag.overItemId = null;
        reorderDrag.overItemType = null;
        reorderDrag.overPosition = null;

        const blank = new Image();
        blank.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
        e.dataTransfer.setDragImage(blank, 0, 0);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", itemId);

        requestAnimationFrame(() => row.classList.add("reorder-dragging"));

      } else {
        // ── FOLDER-MOVE drag (existing behaviour) ──
        const bid = row.dataset.bid;
        const fid = row.dataset.fid;

        if (bid) {
          if (selectedIds.has(bid)) {
            dragIds = new Set(selectedIds);
            dragFolderIds = selectedFolderIds.size ? new Set(selectedFolderIds) : new Set();
          } else {
            dragIds = new Set([bid]);
            dragFolderIds = new Set();
          }
          createDragGhost(dragIds, dragFolderIds);
        } else if (fid) {
          if (selectedFolderIds.has(fid)) {
            dragFolderIds = new Set(selectedFolderIds);
            dragIds = selectedIds.size ? new Set(selectedIds) : new Set();
          } else {
            dragFolderIds = new Set([fid]);
            dragIds = new Set();
          }
          createDragGhost(dragIds, dragFolderIds);
        }

        const blank = new Image();
        blank.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
        e.dataTransfer.setDragImage(blank, 0, 0);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", bid || fid || "");
        requestAnimationFrame(() => row.classList.add("dragging"));
      }
    });

    row.addEventListener("dragend", () => {
      dragFromHandle = false;
      row.classList.remove("reorder-dragging", "dragging");
      hideIndicator();

      if (reorderDrag.active) {
        reorderDrag.active = false;
        reorderDrag.itemId = null;
        reorderDrag.itemType = null;
        reorderDrag.sourceEl = null;
        reorderDrag.overItemId = null;
        reorderDrag.overItemType = null;
        reorderDrag.overPosition = null;
      } else {
        dragIds.clear();
        dragFolderIds.clear();
        removeDragGhost();
      }
    });

    row.addEventListener("dragover", (e) => {
      if (!reorderDrag.active) {
        if (dragIds.size || dragFolderIds.size) {
  e.preventDefault();
  if (row.dataset.fid) {
    // Clear any other highlighted rows first
    document.querySelectorAll("#orderedList .drag-over").forEach(el => el.classList.remove("drag-over"));
    row.classList.add("drag-over");
  }
}
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      const rect = row.getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      const overId = row.dataset.bid || row.dataset.fid;
      const overType = row.dataset.bid ? "bookmark" : "folder";

      if (overId === reorderDrag.itemId && overType === reorderDrag.itemType) {
        hideIndicator();
        return;
      }

      reorderDrag.overItemId = overId;
      reorderDrag.overItemType = overType;
      reorderDrag.overPosition = position;
      showIndicator(row, position);
    });
row.addEventListener("dragleave", (e) => {
  if (!row.contains(e.relatedTarget)) row.classList.remove("drag-over");
});

    row.addEventListener("drop", async (e) => {
      // Handle reorder drop
      if (reorderDrag.active) {
        e.preventDefault();
        e.stopPropagation();

        const { itemId, itemType, overItemId, overItemType, overPosition } = reorderDrag;
        hideIndicator();
        reorderDrag.active = false;

        if (!overItemId || (overItemId === itemId && overItemType === itemType)) return;
        await commitReorder(resolvedItems, itemId, itemType, overItemId, overItemType, overPosition);
        return;
      }

      // Handle folder-move drop onto a folder row
      if ((dragIds.size || dragFolderIds.size) && row.dataset.fid) {
  e.preventDefault();
  e.stopPropagation();
  const targetFid = row.dataset.fid;

  const bmIds = [...dragIds];
  const folIds = [...dragFolderIds].filter(id => id !== targetFid);
  dragIds.clear();
  dragFolderIds.clear();

  document.querySelectorAll("#orderedList .drag-over").forEach(el => el.classList.remove("drag-over")); // ← ADD HERE
  if (bmIds.length) await executeBulkMove(bmIds, targetFid);
  if (folIds.length) await executeBulkMoveFolders(folIds, targetFid);
  removeDragGhost();
}
    });
  });

  // Prevent the container from swallowing dragover during reorder
  const list2 = document.getElementById("orderedList");
  if (list2) {
    list2.addEventListener("dragover", (e) => {
      if (reorderDrag.active) e.preventDefault();
    });
  }
}

// ── Commit reorder: compute new position and save to server ───────────────────
async function commitReorder(currentItems, dragId, dragType, overId, overType, position) {
  // Build current order array without the dragged item
  const withoutDrag = currentItems.filter(
    item => !(item.id === dragId && item.item_type === dragType)
  );

  // Find index of the target item
  const overIdx = withoutDrag.findIndex(
    item => item.id === overId && item.item_type === overType
  );
  if (overIdx === -1) return;

  // Insert dragged item at new position
  const insertIdx = position === "before" ? overIdx : overIdx + 1;
  const draggedItem = currentItems.find(i => i.id === dragId && i.item_type === dragType);
  if (!draggedItem) return;

  const newOrder = [...withoutDrag];
  newOrder.splice(insertIdx, 0, draggedItem);

  // Compute new position using float midpoint
  const prevPos = insertIdx > 0 ? (newOrder[insertIdx - 1].position ?? (insertIdx * 1000)) : 0;
  const nextPos = insertIdx < newOrder.length - 1
    ? (newOrder[insertIdx + 1].position ?? ((insertIdx + 2) * 1000))
    : prevPos + 2000;

  let newPos = (prevPos + nextPos) / 2;

  // Update local cache optimistically
  const folderId = currentFilter.type === "folder" ? currentFilter.value : null;
  const cacheKey = folderId || "__root__";
  const cachedItems = orderedItemsCache[cacheKey];
  if (cachedItems) {
    const targetInCache = cachedItems.find(
      i => (i.id || i.item_id) === dragId && i.item_type === dragType
    );
    if (targetInCache) {
      targetInCache.position = newPos;
      // Re-sort the cache
      orderedItemsCache[cacheKey] = cachedItems.sort((a, b) => a.position - b.position);
    }
  }

  // Re-render immediately (optimistic)
  render();

  // Save to server: send full new order
  const orderedPayload = newOrder.map(item => ({
    item_id: item.id,
    item_type: item.item_type,
  }));

  try {
    const res = await fetch(`${API}/folder/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder_id: folderId,
        items: orderedPayload,
      }),
    });
    if (!res.ok) throw new Error();

    // Refresh cache from server to get clean positions
    await fetchOrderedContents(folderId, vaults[0]?.name || "default");
    render();
  } catch {
    toast("❌ Failed to save order");
    // Revert: re-fetch from server
    await fetchOrderedContents(folderId, vaults[0]?.name || "default");
    render();
  }
}

function updateMainHeader(count) {
  const titles = {
    all: "All Bookmarks",
    archived: "Archived",
    screenshot: "With Screenshot",
    vault: `Vault: ${currentFilter.value}`,
    tag: `Tag: #${currentFilter.value}`,
    folder: `📁 ${folderName(currentFilter.value) || currentFilter.value}`,
  };
  document.getElementById("mainTitle").textContent = titles[currentFilter.type] || "Bookmarks";
  document.getElementById("mainSubtitle").textContent =
    `${count} bookmark${count !== 1 ? "s" : ""}${searchQuery ? ` matching "${searchQuery}"` : ""}`;
}

// ── Thumb helpers ─────────────────────────────────────────────────────────────
function thumbImg(id) {
  return `<img data-thumb-id="${escAttr(id)}" src="${API}/static/archive/${escAttr(id)}.jpeg" alt="" onerror="this.style.display='none'">`;
}
function placeholderDiv(large) {
  return `<div class="${large ? "card-thumb-placeholder" : "row-thumb-placeholder"}">🔖</div>`;
}
function folderBadgeHtml(folder_id) {
  const name = folderName(folder_id);
  if (!name) return "";
  return `<span class="badge badge-folder" data-filter-folder="${escAttr(folder_id)}"
               title="Filter by this folder" style="cursor:pointer">📁 ${escHtml(name)}</span>`;
}

function faviconHtml(bm) {
  if (bm.favicon_path) {
    return `<img src="${API}/static/favicons/${bm.id}.ico" style="width:14px;height:14px;vertical-align:text-bottom;margin-right:6px;border-radius:2px;" onerror="this.style.display='none'">`;
  } else if (bm.favicon_url) {
    return `<img src="${escAttr(bm.favicon_url)}" style="width:14px;height:14px;vertical-align:text-bottom;margin-right:6px;border-radius:2px;" onerror="this.style.display='none'">`;
  }
  return `<span style="font-size:12px;margin-right:6px;opacity:0.7">🌐</span>`;
}

// ── Grip handle HTML ──────────────────────────────────────────────────────────
function gripHandle() {
  return `<div class="reorder-handle" title="Drag to reorder">
    <svg width="14" height="18" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="3" cy="2.5" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="2.5" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="7" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="11.5" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="11.5" r="1.2" fill="currentColor"/>
    </svg>
  </div>`;
}

// ── Card HTML (grid view — unchanged) ────────────────────────────────────────
function cardHtml(bm, idx) {
  const thumb = bm.screenshot ? thumbImg(bm.id) : placeholderDiv(true);
  const tags = (bm.tags || []).slice(0, 2).map(t =>
    `<span class="badge badge-tag">${escHtml(t)}</span>`).join("");
  const date = bm.created_at
    ? new Date(bm.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const isSel = selectedIds.has(bm.id);

  return `<div class="bookmark-card${isSel ? " selected" : ""}"
               data-bid="${escAttr(bm.id)}" data-idx="${idx}">
    <div class="card-checkbox" title="Select"></div>
    <div class="card-thumb">${thumb}</div>
    ${bm.archived ? '<span class="card-archived-badge">📦 Archived</span>' : ""}
    <div class="card-actions">
      <button class="card-action-btn" data-action="open"    data-bid="${escAttr(bm.id)}" title="Open URL">↗</button>
      ${bm.archived ? `<button class="card-action-btn" data-action="archive" data-bid="${escAttr(bm.id)}" title="View archive">📄</button>` : ""}
      <button class="card-action-btn danger" data-action="delete" data-bid="${escAttr(bm.id)}" title="Delete">🗑</button>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(bm.title || bm.url)}</div>
      <div class="card-url" style="display:flex;align-items:center;">
        ${faviconHtml(bm)}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(hostOf(bm.url))}</span>
      </div>
      <div class="card-meta">
        <span class="badge badge-vault">${escHtml(bm.vault || "default")}</span>
        ${folderBadgeHtml(bm.folder_id)}
        ${tags}
        ${date ? `<span class="badge badge-date">${date}</span>` : ""}
      </div>
    </div>
  </div>`;
}

// ── Row HTML (list view — bookmark) ──────────────────────────────────────────
function rowHtml(bm, idx) {
  const thumb = bm.screenshot
    ? `<div class="row-thumb">${thumbImg(bm.id)}</div>`
    : `<div class="row-thumb">${placeholderDiv(false)}</div>`;
  const tags = (bm.tags || []).slice(0, 2).map(t =>
    `<span class="badge badge-tag">${escHtml(t)}</span>`).join("");
  const isSel = selectedIds.has(bm.id);

  return `
    <div class="bookmark-row${isSel ? " selected" : ""}"
         data-bid="${escAttr(bm.id)}" data-idx="${idx}" draggable="false">
      ${gripHandle()}
      ${thumb}
      <div class="row-info">
        <div class="row-title">${escHtml(bm.title || bm.url)}</div>
        <div class="row-url" style="display:flex;align-items:center;">
          ${faviconHtml(bm)}
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(bm.url)}</span>
        </div>
      </div>
      <div class="row-badges">
        <span class="badge badge-vault">${escHtml(bm.vault || "default")}</span>
        ${folderBadgeHtml(bm.folder_id)}
        ${tags}
        ${bm.archived ? '<span class="badge" style="background:rgba(59,130,246,0.1);color:var(--blue)">📦</span>' : ""}
      </div>
      <div class="row-actions">
        <button class="action-btn" data-action="open"    data-bid="${escAttr(bm.id)}">↗ Open</button>
        ${bm.archived ? `<button class="action-btn" data-action="archive" data-bid="${escAttr(bm.id)}">📄 View</button>` : ""}
        <button class="action-btn danger" data-action="delete" data-bid="${escAttr(bm.id)}">🗑</button>
      </div>
    </div>`;
}

// ── Folder row HTML (list view — for ordered interleaved list) ────────────────
function folderRowHtml(folder, idx) {
  const isSel = selectedFolderIds.has(folder.id);
  const count = (folder.subfolder_count || 0) + (folder.bookmark_count || 0);

  return `
    <div class="bookmark-row folder-row${isSel ? " selected" : ""}"
         data-fid="${escAttr(folder.id)}" data-idx="${idx}" draggable="false">
      ${gripHandle()}

      <div class="row-thumb" style="display:flex;align-items:center;justify-content:center;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.15);">
        <span style="font-size:20px">📁</span>
      </div>
      <div class="row-info">
        <div class="row-title" style="color:var(--yellow)">${escHtml(folder.name)}</div>
        <div class="row-url" style="font-family:'JetBrains Mono',monospace">
          ${count} item${count !== 1 ? "s" : ""}
        </div>
      </div>
      <div class="row-badges">
        <span class="badge" style="background:rgba(245,158,11,0.12);color:var(--yellow)">📁 Folder</span>
      </div>
      <div class="row-actions">
        <button class="action-btn" data-action="open-folder" data-fid="${escAttr(folder.id)}">↗ Open</button>
        <button class="action-btn danger" data-action="delete-folder" data-fid="${escAttr(folder.id)}">🗑</button>
      </div>
    </div>`;
}

// ── Grid view: bind subfolder cards ──────────────────────────────────────────
function bindSubfolderCards() {
  const container = document.getElementById("bookmarksContainer");
  container.querySelectorAll(".subfolder-card").forEach(card => {
    const fid = card.dataset.fid;

    card.addEventListener("click", (e) => {
      const isCheckbox = e.target.closest(".subfolder-checkbox");
      if (isCheckbox || e.shiftKey || e.metaKey || e.ctrlKey ||
        selectedIds.size > 0 || selectedFolderIds.size > 0) {
        e.preventDefault();
        if (selectedFolderIds.has(fid)) selectedFolderIds.delete(fid);
        else selectedFolderIds.add(fid);
        updateBulkBar();
        render();
      }
    });

    card.addEventListener("dblclick", async (e) => {
      if (e.target.closest(".subfolder-checkbox")) return;
      document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i =>
        i.classList.toggle("active", i.dataset.filter === "folder" && i.dataset.value === fid));
      currentFilter = { type: "folder", value: fid };
      clearSelection();
      if (currentView === "list") await ensureOrderedItems();
      render();
    });

    card.addEventListener("dragover", (e) => {
      if (!dragIds.size && !dragFolderIds.size) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove("drag-over");
    });
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");

      const droppingFolderIntoItself = dragFolderIds.has(fid);
      const bmIds = [...dragIds];
      const folIds = [...dragFolderIds].filter(id => id !== fid);
      dragIds.clear();
      dragFolderIds.clear();

      if (bmIds.length) await executeBulkMove(bmIds, fid);
      if (folIds.length) await executeBulkMoveFolders(folIds, fid);
      if (droppingFolderIntoItself && folIds.length < dragFolderIds.size) {
        toast("❌ Can't move a folder into itself");
      }
      removeDragGhost();
    });

    card.addEventListener("dragstart", (e) => {
      if (selectedFolderIds.has(fid)) {
        dragFolderIds = new Set(selectedFolderIds);
        if (selectedIds.size) dragIds = new Set(selectedIds);
      } else {
        dragFolderIds = new Set([fid]);
        dragIds = new Set();
      }
      createDragGhost(dragIds, dragFolderIds);
      const blank = new Image();
      blank.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      e.dataTransfer.setDragImage(blank, 0, 0);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", fid);
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragFolderIds.clear();
      dragIds.clear();
      removeDragGhost();
    });
  });
}

// ── Grid view: bind bookmark cards ───────────────────────────────────────────
function bindBookmarkCards() {
  const container = document.getElementById("bookmarksContainer");
  const items = getFiltered();

  container.querySelectorAll("[data-bid]").forEach((el, idx) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".card-action-btn, .action-btn, [data-filter-folder]")) return;

      const isCheckbox = e.target.closest(".card-checkbox, .row-checkbox");
      if (isCheckbox || e.shiftKey || e.metaKey || e.ctrlKey ||
        selectedIds.size > 0 || selectedFolderIds.size > 0) {
        e.preventDefault();
        handleSelectionClick(el.dataset.bid, idx, e.shiftKey, items);
        return;
      }
      const bm = allBookmarks.find(b => b.id === el.dataset.bid);
      if (bm) openDetail(bm);
    });

    el.setAttribute("draggable", "true");

    el.addEventListener("dragstart", (e) => {
      if (e.target.closest(".card-action-btn, .action-btn, .card-checkbox, .row-checkbox, [data-filter-folder]")) {
        e.preventDefault();
        return;
      }
      const bid = el.dataset.bid;
      if (selectedIds.has(bid)) {
        dragIds = new Set(selectedIds);
        if (selectedFolderIds.size) dragFolderIds = new Set(selectedFolderIds);
        else dragFolderIds = new Set();
      } else {
        dragIds = new Set([bid]);
        dragFolderIds = new Set();
      }
      createDragGhost(dragIds, dragFolderIds);
      const blank = new Image();
      blank.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      e.dataTransfer.setDragImage(blank, 0, 0);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", [...dragIds].join(","));
      requestAnimationFrame(() => el.classList.add("dragging"));
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      dragIds.clear();
      dragFolderIds.clear();
      removeDragGhost();
    });
  });
}

// ── Bind action buttons in list view rows ─────────────────────────────────────
function bindBookmarkRowActions() {
  const container = document.getElementById("bookmarksContainer");

  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Folder row actions
      if (btn.dataset.action === "open-folder") {
        const fid = btn.dataset.fid;
        currentFilter = { type: "folder", value: fid };
        clearSelection();
        if (currentView === "list") await ensureOrderedItems();
        render();
        return;
      }
      if (btn.dataset.action === "delete-folder") {
        const fid = btn.dataset.fid;
        const folder = folderMap[fid];
        if (!confirm(`Delete folder "${folder?.name || fid}"? Bookmarks inside will be moved to root.`)) return;
        try {
          const res = await fetch(`${API}/folders/${fid}`, { method: "DELETE" });
          if (!res.ok) throw new Error();
          delete folderMap[fid];
          const cacheKey = currentFilter.type === "folder" ? currentFilter.value || "__root__" : "__root__";
          if (orderedItemsCache[cacheKey]) {
            orderedItemsCache[cacheKey] = orderedItemsCache[cacheKey].filter(
              i => !((i.id || i.item_id) === fid && i.item_type === "folder")
            );
          }
          await renderSidebar();
          render();
          toast("🗑 Folder deleted");
        } catch { toast("❌ Delete failed"); }
        return;
      }

      // Bookmark row actions
      const bm = allBookmarks.find(b => b.id === btn.dataset.bid);
      if (!bm) return;
      if (btn.dataset.action === "open") window.open(bm.url, "_blank");
      if (btn.dataset.action === "archive") openPreview(bm);
      if (btn.dataset.action === "delete") confirmDelete(bm);
    });
  });
}

// ── Selection ─────────────────────────────────────────────────────────────────
function handleSelectionClick(bid, idx, isShift, visibleItems) {
  if (isShift && lastClickedIdx >= 0) {
    const lo = Math.min(lastClickedIdx, idx);
    const hi = Math.max(lastClickedIdx, idx);
    for (let i = lo; i <= hi; i++) {
      if (visibleItems[i]) selectedIds.add(visibleItems[i].id);
    }
  } else {
    if (selectedIds.has(bid)) {
      selectedIds.delete(bid);
    } else {
      selectedIds.add(bid);
    }
  }
  lastClickedIdx = idx;
  updateBulkBar();
  render();
}

function clearSelection() {
  selectedIds.clear();
  selectedFolderIds.clear();
  lastClickedIdx = -1;
  updateBulkBar();
  render();
}

function updateBulkBar() {
  const bar = document.getElementById("bulkBar");
  const bmCount = selectedIds.size;
  const folCount = selectedFolderIds.size;
  const total = bmCount + folCount;

  let label = `${total} selected`;
  if (bmCount && folCount) label = `${bmCount} bookmark${bmCount !== 1 ? "s" : ""} + ${folCount} folder${folCount !== 1 ? "s" : ""}`;
  else if (folCount) label = `${folCount} folder${folCount !== 1 ? "s" : ""}`;

  document.getElementById("bulkCount").textContent = label;
  bar.classList.toggle("visible", total > 0);

  document.getElementById("bulkTag").style.opacity = bmCount ? "1" : "0.4";
  document.getElementById("bulkTag").style.pointerEvents = bmCount ? "auto" : "none";

  const canFetch = (bmCount > 0 && folCount === 0);
  document.getElementById("bulkFetch").style.opacity = canFetch ? "1" : "0.4";
  document.getElementById("bulkFetch").style.pointerEvents = canFetch ? "auto" : "none";

  const visible = getFiltered();
  const visibleFolders = getVisibleSubfolders();
  const allSel = visible.every(b => selectedIds.has(b.id)) &&
    visibleFolders.every(f => selectedFolderIds.has(f.id)) &&
    (visible.length + visibleFolders.length) > 0;
  document.getElementById("selectAllBtn").textContent = allSel ? "Deselect all" : "Select all";
}

// ── Bulk Delete ───────────────────────────────────────────────────────────────
async function bulkDeleteSelected() {
  const bmIds = [...selectedIds];
  const folIds = [...selectedFolderIds];
  const total = bmIds.length + folIds.length;
  if (!total) return;

  const parts = [];
  if (bmIds.length) parts.push(`${bmIds.length} bookmark${bmIds.length > 1 ? "s" : ""}`);
  if (folIds.length) parts.push(`${folIds.length} folder${folIds.length > 1 ? "s" : ""}`);
  if (!confirm(`Delete ${parts.join(" and ")}? This cannot be undone.`)) return;

  let deleted = 0;
  for (const id of bmIds) {
    try {
      const res = await fetch(`${API}/bookmark/${id}`, { method: "DELETE" });
      if (res.ok) deleted++;
    } catch { }
  }
  for (const id of folIds) {
    try {
      const res = await fetch(`${API}/folders/${id}`, { method: "DELETE" });
      if (res.ok) deleted++;
    } catch { }
  }

  allBookmarks = allBookmarks.filter(b => !bmIds.includes(b.id));
  folIds.forEach(id => delete folderMap[id]);

  // Clear affected caches
  const folderId = currentFilter.type === "folder" ? currentFilter.value : null;
  const cacheKey = folderId || "__root__";
  if (orderedItemsCache[cacheKey]) {
    orderedItemsCache[cacheKey] = orderedItemsCache[cacheKey].filter(item => {
      const id = item.id || item.item_id;
      if (item.item_type === "bookmark") return !bmIds.includes(id);
      if (item.item_type === "folder") return !folIds.includes(id);
      return true;
    });
  }

  clearSelection();
  updateStats();
  renderSidebar();
  render();
  toast(`🗑 Deleted ${deleted} item${deleted !== 1 ? "s" : ""}`);
}

// ── Bulk Fetch ────────────────────────────────────────────────────────────────
async function executeBulkFetch() {
  const bmIds = targetFetchIds;
  if (!bmIds.length) return;

  const doArchive = document.getElementById("bulkFetchArchiveCheck").checked;

  document.getElementById("bulkFetchOverlay").classList.remove("open");
  toast(`⏳ Fetching ${bmIds.length} item${bmIds.length > 1 ? "s" : ""}... Please wait.`, 60000);

  try {
    const res = await fetch(`${API}/bookmarks/bulk-fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: bmIds, archive: doArchive }),
    });

    if (!res.ok) throw new Error();
    const data = await res.json();

    data.successful_ids.forEach(id => {
      const bm = allBookmarks.find(b => b.id === id);
      if (bm) {
        bm.screenshot = true;
        bm.favicon_path = "ready";
        if (doArchive) {
          bm.archived = true;
          bm.html_path = "ready";
        }
      }
    });

    clearSelection();
    updateStats();

    if (document.getElementById("detailOverlay").classList.contains("open") && bmIds.length === 1) {
      const updatedBm = allBookmarks.find(b => b.id === bmIds[0]);
      if (updatedBm) openDetail(updatedBm);
    }

    render();

    if (data.successful_count === data.total_requested) {
      toast(`✅ Successfully fetched ${data.successful_count} bookmark${data.successful_count > 1 ? "s" : ""}!`, 4000);
    } else {
      toast(`⚠ Fetched ${data.successful_count} out of ${data.total_requested}.`, 5000);
    }

  } catch {
    toast("❌ Fetch failed due to a network error.");
  }
}

// ── Folder picker ─────────────────────────────────────────────────────────────
function openFolderPicker(mode) {
  folderPickerMode = mode;
  folderPickerSelId = null;

  const bmCount = selectedIds.size;
  const folCount = selectedFolderIds.size;
  const total = bmCount + folCount;
  const verb = mode === "move" ? "Move" : "Copy";

  let label = `${total} item${total !== 1 ? "s" : ""}`;
  if (bmCount && folCount) label = `${bmCount} bookmark${bmCount !== 1 ? "s" : ""} + ${folCount} folder${folCount !== 1 ? "s" : ""}`;
  else if (folCount) label = `${folCount} folder${folCount !== 1 ? "s" : ""}`;
  else label = `${bmCount} bookmark${bmCount !== 1 ? "s" : ""}`;

  document.getElementById("folderPickerTitle").textContent = `${verb} ${label} to…`;

  const body = document.getElementById("folderPickerBody");
  const folders = flatFolderList();

  body.innerHTML = `
    <div class="folder-pick-item${folderPickerSelId === null ? " selected-pick" : ""}"
         data-pick-folder="__root__">
      🗂 &nbsp;Root (no folder)
    </div>
    ${folders.map(f => `
      <div class="folder-pick-item" data-pick-folder="${escAttr(f.id)}"
           style="padding-left:${18 + f.depth * 14}px">
        📁 ${escHtml(f.name)}
        <span style="margin-left:auto;font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">
          ${f.vault}
        </span>
      </div>
    `).join("")}
  `;

  body.querySelectorAll("[data-pick-folder]").forEach(el => {
    el.addEventListener("click", () => {
      body.querySelectorAll("[data-pick-folder]").forEach(e => e.classList.remove("selected-pick"));
      el.classList.add("selected-pick");
      folderPickerSelId = el.dataset.pickFolder === "__root__" ? null : el.dataset.pickFolder;
    });
  });

  document.getElementById("folderPickerOverlay").classList.add("open");
}

function closeFolderPicker() {
  document.getElementById("folderPickerOverlay").classList.remove("open");
  folderPickerMode = null;
  folderPickerSelId = null;
}

async function confirmFolderPick() {
  if (folderPickerMode === "move") {
    const bmIds = [...selectedIds];
    const folIds = [...selectedFolderIds];
    const target = folderPickerSelId;

    closeFolderPicker();
    clearSelection();

    if (bmIds.length) await executeBulkMove(bmIds, target);
    if (folIds.length) await executeBulkMoveFolders(folIds, target);

  } else if (folderPickerMode === "copy") {
    const bmIds = [...selectedIds];
    const target = folderPickerSelId;

    closeFolderPicker();
    clearSelection();

    if (bmIds.length) await executeBulkCopy(bmIds, target);
  }
}

async function executeBulkMove(ids, folderId) {
  if (!ids.length) return;
  try {
    const res = await fetch(`${API}/bookmarks/bulk-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, folder_id: folderId }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    ids.forEach(id => {
      const bm = allBookmarks.find(b => b.id === id);
      if (bm) bm.folder_id = folderId;
    });

    // Invalidate both source and target caches
    const srcKey = currentFilter.type === "folder" ? currentFilter.value || "__root__" : "__root__";
if (orderedItemsCache[srcKey]) {
  orderedItemsCache[srcKey] = orderedItemsCache[srcKey].filter(
    i => !ids.includes(i.id || i.item_id)
  );
}
    if (folderId) delete orderedItemsCache[folderId];
    console.log(currentFilter) 
    render();
    renderSidebar();
    toast(`✦ Moved ${data.count} bookmark${data.count !== 1 ? "s" : ""}`);
  } catch { toast("❌ Move failed"); }
}

async function executeBulkMoveFolders(folderIds, newParentId) {
  if (!folderIds.length) return;
  let moved = 0;
  const errors = [];

  for (const id of folderIds) {
    const desc = descendantIds(id);
    if (newParentId && desc.has(newParentId)) {
      errors.push(`Can't move "${folderMap[id]?.name || id}" into itself`);
      continue;
    }
    try {
      const res = await fetch(`${API}/folders/${id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: newParentId ?? null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errors.push(err.detail || `Move failed for folder ${id}`);
        continue;
      }
      moved++;
      if (folderMap[id]) folderMap[id].parent_id = newParentId ?? null;
    } catch (e) {
      errors.push(`Network error moving folder ${id}`);
    }
  }

  if (moved) {
    // Invalidate caches
    const srcKey = currentFilter.type === "folder" ? currentFilter.value || "__root__" : "__root__";
if (orderedItemsCache[srcKey]) {
  orderedItemsCache[srcKey] = orderedItemsCache[srcKey].filter(
    i => !folderIds.includes(i.id || i.item_id)
  );
}
    if (newParentId) delete orderedItemsCache[newParentId];
    await renderSidebar();
    render();
    toast(`✦ Moved ${moved} folder${moved !== 1 ? "s" : ""}`);
  }
  if (errors.length) {
    toast(`❌ ${errors[0]}`);
  }
}

async function executeBulkCopy(ids, folderId) {
  if (!ids.length) return;
  try {
    const res = await fetch(`${API}/bookmarks/bulk-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, folder_id: folderId }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    allBookmarks.push(...(data.bookmarks || []));

    // Invalidate target cache
    if (folderId) delete orderedItemsCache[folderId];
    else delete orderedItemsCache["__root__"];

    updateStats();
    render();
    renderSidebar();
    toast(`⧉ Copied ${data.count} bookmark${data.count !== 1 ? "s" : ""}`);
  } catch { toast("❌ Copy failed"); }
}

// ── Bulk tag modal ────────────────────────────────────────────────────────────
function openBulkTagModal() {
  document.getElementById("bulkTagTitle").textContent =
    `Edit tags for ${selectedIds.size} bookmark${selectedIds.size > 1 ? "s" : ""}`;
  document.getElementById("bulkTagAdd").value = "";
  document.getElementById("bulkTagRemove").value = "";
  document.getElementById("bulkTagOverlay").classList.add("open");
}
function closeBulkTagModal() {
  document.getElementById("bulkTagOverlay").classList.remove("open");
}
async function applyBulkTag() {
  const addRaw = document.getElementById("bulkTagAdd").value;
  const removeRaw = document.getElementById("bulkTagRemove").value;
  const add = addRaw.split(",").map(t => t.trim()).filter(Boolean);
  const remove = removeRaw.split(",").map(t => t.trim()).filter(Boolean);
  if (!add.length && !remove.length) { closeBulkTagModal(); return; }

  try {
    const res = await fetch(`${API}/bookmarks/bulk-tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], add, remove }),
    });
    if (!res.ok) throw new Error();
    const addLower = add.map(t => t.toLowerCase());
    const removeLower = remove.map(t => t.toLowerCase());
    [...selectedIds].forEach(id => {
      const bm = allBookmarks.find(b => b.id === id);
      if (!bm) return;
      let tags = bm.tags || [];
      tags = tags.filter(t => !removeLower.includes(t));
      addLower.forEach(t => { if (!tags.includes(t)) tags.push(t); });
      bm.tags = tags;
    });
    closeBulkTagModal();
    render();
    renderSidebar();
    toast(`🏷 Tags updated on ${selectedIds.size} bookmark${selectedIds.size > 1 ? "s" : ""}`);
  } catch { toast("❌ Tag update failed"); }
}

// ── Single delete ─────────────────────────────────────────────────────────────
async function confirmDelete(bm) {
  if (!bm) return;
  if (!confirm(`Delete "${bm.title || bm.url}"?`)) return;
  try {
    const res = await fetch(`${API}/bookmark/${bm.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    allBookmarks = allBookmarks.filter(b => b.id !== bm.id);
    selectedIds.delete(bm.id);

    // Remove from ordered cache
    const cacheKey = bm.folder_id || "__root__";
    if (orderedItemsCache[cacheKey]) {
      orderedItemsCache[cacheKey] = orderedItemsCache[cacheKey].filter(
        i => !((i.id || i.item_id) === bm.id && i.item_type === "bookmark")
      );
    }

    updateStats();
    renderSidebar();
    updateBulkBar();
    render();
    closeDetail();
    toast("🗑 Bookmark deleted");
  } catch { toast("❌ Delete failed"); }
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function openDetail(bm) {
  document.getElementById("detailTitle").textContent = bm.title || bm.url;

  const thumb = bm.screenshot
    ? `<img src="${API}/static/archive/${bm.id}.jpeg" onerror="this.style.display='none'">`
    : `<div class="detail-thumb-placeholder">🔖</div>`;
  const date = bm.created_at ? new Date(bm.created_at).toLocaleString() : "—";
  const folder = folderName(bm.folder_id);

  document.getElementById("detailBody").innerHTML = `
    <div class="detail-thumb">${thumb}</div>
    <div class="detail-title">${escHtml(bm.title || "Untitled")}</div>
    <div class="detail-url" data-url="${escAttr(bm.url)}" style="display:flex;align-items:center;">
      ${faviconHtml(bm)}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(bm.url)}</span>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Vault</div>
      <div class="detail-field-value">📁 ${escHtml(bm.vault || "default")}</div>
    </div>
    ${folder ? `
    <div class="detail-field">
      <div class="detail-field-label">Folder</div>
      <div class="detail-field-value">
        <span class="badge badge-folder" data-filter-folder="${escAttr(bm.folder_id)}"
              style="cursor:pointer;font-size:11px">📁 ${escHtml(folder)}</span>
      </div>
    </div>` : ""}
    <div class="detail-field" id="detailTagsField">
      <div class="detail-field-label">Tags
        <button id="editTagsBtn" style="margin-left:6px;font-size:10px;padding:1px 6px;border-radius:4px;
                border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;
                font-family:inherit;" title="Edit tags">Edit</button>
      </div>
      <div id="detailTagsDisplay" class="detail-tags">${renderTagBadges(bm.tags || [])}</div>
      <div id="detailTagsEditor" style="display:none">
        <div class="tag-editor-row" id="tagPillsRow">${renderTagPills(bm.tags || [])}</div>
        <input class="tag-input" id="tagInput" placeholder="Type a tag and press Enter…">
        <button class="tag-save-btn" id="tagSaveBtn">Save tags</button>
      </div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Saved</div>
      <div class="detail-field-value" style="font-family:'JetBrains Mono',monospace;font-size:11px">${date}</div>
    </div>
    <div class="detail-field">
      <div class="detail-field-label">Status</div>
      <div class="detail-field-value">
        ${bm.archived ? "📦 Archived HTML" : "—"}&nbsp;&nbsp;
        ${bm.screenshot ? "📸 Screenshot" : "—"}
      </div>
    </div>
    ${bm.notes ? `
    <div class="detail-field">
      <div class="detail-field-label">Notes</div>
      <div class="detail-notes">${escHtml(bm.notes)}</div>
    </div>` : ""}
  `;

  document.querySelector(".detail-url[data-url]")
    ?.addEventListener("click", (e) => window.open(e.currentTarget.dataset.url, "_blank"));

  document.querySelector("#detailBody [data-filter-folder]")
    ?.addEventListener("click", (e) => {
      const fid = e.currentTarget.dataset.filterFolder;
      closeDetail();
      setFolderFilter(fid);
    });

  let editingTags = [...(bm.tags || [])];
  const editBtn = document.getElementById("editTagsBtn");
  const display = document.getElementById("detailTagsDisplay");
  const editor = document.getElementById("detailTagsEditor");
  const pillRow = document.getElementById("tagPillsRow");
  const input = document.getElementById("tagInput");
  const saveBtn = document.getElementById("tagSaveBtn");

  function refreshPills() {
    pillRow.innerHTML = renderTagPills(editingTags);
    pillRow.querySelectorAll(".tag-pill-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        editingTags = editingTags.filter(t => t !== btn.dataset.removeTag);
        refreshPills();
      });
    });
  }
  refreshPills();

  editBtn.addEventListener("click", () => {
    display.style.display = "none";
    editor.style.display = "block";
    editBtn.textContent = "Cancel";
    editBtn.onclick = () => {
      display.style.display = "";
      editor.style.display = "none";
      editingTags = [...(bm.tags || [])];
      editBtn.textContent = "Edit";
      editBtn.onclick = null;
      editBtn.addEventListener("click", arguments.callee, { once: true });
    };
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = input.value.trim().toLowerCase().replace(/,/g, "");
      if (val && !editingTags.includes(val)) {
        editingTags.push(val);
        refreshPills();
      }
      input.value = "";
    }
  });

  saveBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API}/bookmark/${bm.id}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: editingTags }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      const local = allBookmarks.find(b => b.id === bm.id);
      if (local) local.tags = updated.tags;
      bm.tags = updated.tags;
      display.innerHTML = renderTagBadges(updated.tags);
      display.style.display = "";
      editor.style.display = "none";
      editBtn.textContent = "Edit";
      renderSidebar();
      toast("🏷 Tags saved");
    } catch { toast("❌ Failed to save tags"); }
  });

  const footer = document.getElementById("detailFooter");
  footer.innerHTML = `
    <button class="btn btn-primary"        data-action="open-url"     data-url="${escAttr(bm.url)}">↗ Open</button>
    ${bm.archived ? `<button class="btn btn-secondary" data-action="view-archive" data-bid="${escAttr(bm.id)}">📄 Archive</button>` : ""}
    <button class="btn btn-secondary"      data-action="refetch"      data-bid="${escAttr(bm.id)}" style="flex: 0 1 auto;" title="Fetch screenshot & archive">⚡ Fetch</button>
    <button class="btn btn-danger-outline" data-action="delete"       data-bid="${escAttr(bm.id)}" style="flex: 0 1 auto;">🗑</button>
  `;
  footer.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "open-url") window.open(btn.dataset.url, "_blank");
      if (btn.dataset.action === "view-archive") openPreview(allBookmarks.find(b => b.id === btn.dataset.bid));
      if (btn.dataset.action === "refetch") {
        targetFetchIds = [btn.dataset.bid];
        document.getElementById("bulkFetchArchiveCheck").checked = false;
        document.getElementById("bulkFetchTitle").textContent = `Fetch Bookmark`;
        document.getElementById("bulkFetchOverlay").classList.add("open");
      }
      if (btn.dataset.action === "delete") confirmDelete(allBookmarks.find(b => b.id === btn.dataset.bid));
    });
  });

  document.getElementById("detailOverlay").classList.add("open");
}

function renderTagBadges(tags) {
  return tags.length
    ? tags.map(t => `<span class="badge badge-tag">${escHtml(t)}</span>`).join("")
    : `<span style="color:var(--text3);font-size:12px">No tags</span>`;
}

function renderTagPills(tags) {
  return tags.map(t =>
    `<span class="tag-pill">${escHtml(t)}
      <span class="tag-pill-remove" data-remove-tag="${escAttr(t)}" title="Remove">✕</span>
    </span>`
  ).join("");
}

// ── Preview ───────────────────────────────────────────────────────────────────
function openPreview(bm) {
  if (!bm) return;
  document.getElementById("previewTitle").textContent = bm.title || bm.url;
  document.getElementById("previewUrl").textContent = bm.url;
  const iframe = document.getElementById("previewIframe");
  const noArchive = document.getElementById("previewNoArchive");
  if (bm.archived && bm.html_path) {
    iframe.src = `${API}/static/archive/${bm.id}.html`;
    iframe.style.display = "block"; noArchive.style.display = "none";
  } else {
    iframe.src = "about:blank";
    iframe.style.display = "none"; noArchive.style.display = "flex";
  }
  document.getElementById("previewOverlay").classList.add("open");
}
function closePreview() {
  document.getElementById("previewOverlay").classList.remove("open");
  document.getElementById("previewIframe").src = "about:blank";
}

// ── Loading / error ───────────────────────────────────────────────────────────
function showLoading() {
  const skeletons = Array(8).fill(0).map(() => `
    <div class="skeleton">
      <div class="skeleton-thumb"></div>
      <div class="skeleton-body">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line shorter"></div>
      </div>
    </div>`).join("");
  document.getElementById("bookmarksContainer").innerHTML =
    `<div class="loading-grid">${skeletons}</div>`;
}
function showError() {
  document.getElementById("bookmarksContainer").innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">Can't reach powerbookmarkd</div>
      <div class="empty-sub">Make sure the service is running on port 8765</div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function setFolderFilter(fid) {
  currentFilter = { type: "folder", value: fid };
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  document.querySelectorAll(".sidebar-item, .folder-tree-row").forEach(i => {
    i.classList.toggle("active", i.dataset.filter === "folder" && i.dataset.value === fid);
  });
  if (currentView === "list") await ensureOrderedItems();
  render();
}

function closeDetail() { document.getElementById("detailOverlay").classList.remove("open"); }

function toast(msg, dur = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), dur);
}

function hostOf(url) { try { return new URL(url).hostname; } catch { return url; } }

function escHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str = "") { return escHtml(str); }

// ── New Folder Modal ──────────────────────────────────────────────────────────
function openNewFolderModal() {
  const inFolder = currentFilter.type === "folder" && currentFilter.value;
  const parentName = inFolder ? (folderMap[currentFilter.value]?.name || "") : "";

  document.getElementById("newFolderContext").textContent =
    inFolder ? `Inside: 📁 ${parentName}` : "Inside: 🗂 Root";
  document.getElementById("newFolderName").value = "";

  const vaultSel = document.getElementById("newFolderVault");
  const currentVault = currentFilter.type === "vault"
    ? currentFilter.value
    : (vaults[0]?.name || "default");
  vaultSel.innerHTML = vaults.map(v =>
    `<option value="${escAttr(v.name)}"${v.name === currentVault ? " selected" : ""}>${escHtml(v.name)}</option>`
  ).join("") || `<option value="default">default</option>`;

  document.getElementById("newFolderOverlay").classList.add("open");
  setTimeout(() => document.getElementById("newFolderName").focus(), 60);
}

function closeNewFolderModal() {
  document.getElementById("newFolderOverlay").classList.remove("open");
}

async function confirmNewFolder() {
  const name = document.getElementById("newFolderName").value.trim();
  if (!name) { document.getElementById("newFolderName").focus(); return; }

  const vault = document.getElementById("newFolderVault").value;
  const parent_id = (currentFilter.type === "folder" && currentFilter.value)
    ? currentFilter.value
    : null;

  try {
    const res = await fetch(`${API}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id, vault }),
    });
    if (!res.ok) throw new Error();
    const folder = await res.json();
    folderMap[folder.id] = { ...folder };

    // Invalidate ordered cache for the parent folder
    const cacheKey = parent_id || "__root__";
    delete orderedItemsCache[cacheKey];

    closeNewFolderModal();
    await renderSidebar();
    if (currentView === "list") await ensureOrderedItems();
    render();
    toast(`📁 Folder "${name}" created`);
  } catch { toast("❌ Failed to create folder"); }
}

// ── New Bookmark Modal ────────────────────────────────────────────────────────
let fetchedOgImage = null;

function openNewBookmarkModal() {
  fetchedOgImage = null;

  document.getElementById("newBookmarkUrl").value = "";
  document.getElementById("newBookmarkTitle").value = "";
  document.getElementById("newBookmarkTags").value = "";
  document.getElementById("newBookmarkNotes").value = "";
  document.getElementById("newBookmarkArchiveCheck").checked = false;
  document.getElementById("newBookmarkThumbPreview").innerHTML =
    `<span style="font-size:28px">🔖</span>`;
  document.getElementById("newBookmarkMetaStatus").textContent = "";

  const currentVault = currentFilter.type === "vault"
    ? currentFilter.value
    : (vaults[0]?.name || "default");
  const vaultSel = document.getElementById("newBookmarkVault");
  vaultSel.innerHTML = vaults.map(v =>
    `<option value="${escAttr(v.name)}"${v.name === currentVault ? " selected" : ""}>${escHtml(v.name)}</option>`
  ).join("") || `<option value="default">default</option>`;

  const folderSel = document.getElementById("newBookmarkFolder");
  const folders = flatFolderList();
  const currentFid = currentFilter.type === "folder" ? currentFilter.value : null;
  folderSel.innerHTML =
    `<option value="">— No folder —</option>` +
    folders.map(f =>
      `<option value="${escAttr(f.id)}"${f.id === currentFid ? " selected" : ""}
             style="padding-left:${f.depth * 10}px">
        ${"  ".repeat(f.depth)}📁 ${escHtml(f.name)}
      </option>`
    ).join("");

  document.getElementById("newBookmarkOverlay").classList.add("open");
  setTimeout(() => document.getElementById("newBookmarkUrl").focus(), 60);
}

function closeNewBookmarkModal() {
  document.getElementById("newBookmarkOverlay").classList.remove("open");
  fetchedOgImage = null;
}

async function fetchBookmarkMeta() {
  const url = document.getElementById("newBookmarkUrl").value.trim();
  if (!url || !url.startsWith("http")) return;

  const doArchive = document.getElementById("newBookmarkArchiveCheck").checked;
  const status = document.getElementById("newBookmarkMetaStatus");
  const thumb = document.getElementById("newBookmarkThumbPreview");
  const btn = document.getElementById("newBookmarkFetchBtn");

  status.textContent = doArchive ? "Fetching metadata & archiving HTML (~15s)..." : "Spinning up browser...";
  btn.disabled = true;
  btn.textContent = "⏳...";

  try {
    const res = await fetch(`${API}/fetch-meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, archive: doArchive })
    });

    if (!res.ok) throw new Error("Fetch failed");
    const data = await res.json();

    if (data.title && !document.getElementById("newBookmarkTitle").value.trim()) {
      document.getElementById("newBookmarkTitle").value = data.title;
    }

    if (data.screenshot) {
      fetchedOgImage = data.screenshot;
      thumb.innerHTML = `<img src="${fetchedOgImage}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
      status.textContent = doArchive ? "✓ Page info & HTML archive fetched" : "✓ Page info fetched";
    } else {
      status.textContent = "⚠ Couldn't fetch page info";
    }
  } catch (e) {
    status.textContent = "⚠ Couldn't reach page — fill in manually";
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Fetch";
  }
}

async function confirmNewBookmark() {
  const url = document.getElementById("newBookmarkUrl").value.trim();
  if (!url) { document.getElementById("newBookmarkUrl").focus(); return; }

  const titleInput = document.getElementById("newBookmarkTitle").value.trim();
  const vault = document.getElementById("newBookmarkVault").value;
  const folder_id = document.getElementById("newBookmarkFolder").value || null;
  const notes = document.getElementById("newBookmarkNotes").value.trim();
  const tagsRaw = document.getElementById("newBookmarkTags").value;
  const tags = tagsRaw.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);

  let title = titleInput;
  if (!title) title = url;

  const doArchive = document.getElementById("newBookmarkArchiveCheck").checked;

  const body = {
    url, title, vault, tags, notes, folder_id,
    screenshot: !!fetchedOgImage,
    archive: doArchive
  };

  try {
    const res = await fetch(`${API}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const saved = await res.json();

    const newBm = {
      id: saved.id,
      url, title, vault, folder_id, notes, tags,
      created_at: new Date().toISOString(),
      archived: doArchive,
      html_path: doArchive ? "ready" : null,
      screenshot: !!fetchedOgImage,
      favicon_path: "ready",
    };

    allBookmarks.unshift(newBm);

    // Invalidate ordered cache for the folder it was saved to
    const cacheKey = folder_id || "__root__";
    delete orderedItemsCache[cacheKey];

    updateStats();
    closeNewBookmarkModal();
    if (currentView === "list") await ensureOrderedItems();
    render();
    renderSidebar();
    toast(`🔖 Bookmark saved successfully`);
  } catch { toast("❌ Failed to save bookmark"); }
}

// ── Background Syncing ────────────────────────────────────────────────────────
async function silentRefresh() {
  if (dragIds.size > 0 || dragFolderIds.size > 0 || reorderDrag.active) return;
  if (document.getElementById("newBookmarkOverlay").classList.contains("open")) return;
  if (document.getElementById("newFolderOverlay").classList.contains("open")) return;
  if (document.getElementById("folderPickerOverlay").classList.contains("open")) return;
  if (document.getElementById("bulkFetchOverlay").classList.contains("open")) return;

  try {
    const [bmRes, vaultRes] = await Promise.all([
      fetch(`${API}/recent?limit=500`),
      fetch(`${API}/vaults`)
    ]);

    if (!bmRes.ok || !vaultRes.ok) return;

    const bmData = await bmRes.json();
    const vaultData = await vaultRes.json();

    allBookmarks = bmData.bookmarks || [];
    vaults = vaultData.vaults || [];

    // Refresh ordered cache for current view
    if (currentView === "list") await ensureOrderedItems();

    updateStats();
    render();
    await renderSidebar();
    updateBulkBar();

    const detailOverlay = document.getElementById("detailOverlay");
    if (detailOverlay.classList.contains("open")) {
      const deleteBtn = document.querySelector('#detailFooter [data-action="delete"]');
      if (deleteBtn && deleteBtn.dataset.bid) {
        const updatedBm = allBookmarks.find(b => b.id === deleteBtn.dataset.bid);
        if (updatedBm) {
          openDetail(updatedBm);
        } else {
          closeDetail();
        }
      }
    }
  } catch (e) {
    // Silently ignore
  }
}

window.addEventListener("focus", silentRefresh);

// ── Go ────────────────────────────────────────────────────────────────────────
boot();