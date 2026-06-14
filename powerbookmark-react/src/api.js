// src/api.js
export const API_URL = "http://127.0.0.1:8765";

// Helper to catch errors cleanly
const handleResponse = async (res) => {
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "API request failed");
    }
    return res.json();
};

export const api = {
    // --- Queries ---
    getHealth: () => fetch(`${API_URL}/health`).then(handleResponse),

    getVaults: () => fetch(`${API_URL}/vaults`).then(handleResponse),

    getRecentBookmarks: (limit = 500) =>
        fetch(`${API_URL}/recent?limit=${limit}`).then(handleResponse),

    getContents: (vault = "default", folderId = null) => {
        const params = new URLSearchParams({ vault });
        if (folderId) params.set("folder_id", folderId);
        return fetch(`${API_URL}/contents?${params}`).then(handleResponse);
    },

    searchBookmarks: (q, vault, folderId, limit = 50) => {
        const params = new URLSearchParams({ q, limit });
        if (vault) params.set("vault", vault);
        if (folderId) params.set("folder_id", folderId);
        return fetch(`${API_URL}/search?${params}`).then(handleResponse);
    },

    // --- Mutations (We will add the rest as we build the UI) ---
    deleteBookmark: (id) =>
        fetch(`${API_URL}/bookmark/${id}`, { method: "DELETE" }).then(handleResponse),

    deleteFolder: (id) =>
        fetch(`${API_URL}/folders/${id}`, { method: "DELETE" }).then(handleResponse),

    getFolderTree: async (vault) => {
        const all = [];
        const queue = [{ folder_id: null, depth: 0 }];

        while (queue.length) {
            const { folder_id, depth } = queue.shift();
            const params = new URLSearchParams({ vault });
            if (folder_id) params.set("folder_id", folder_id);

            try {
                const res = await fetch(`${API_URL}/contents?${params}`);
                if (!res.ok) break;
                const data = await res.json();
                for (const f of (data.subfolders || [])) {
                    all.push({ ...f, depth, vault });
                    queue.push({ folder_id: f.id, depth: depth + 1 });
                }
            } catch { break; }
        }
        return all;
    },
    // --- Creation ---
    createFolder: (data) =>
        fetch(`${API_URL}/folders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        }).then(handleResponse),

    fetchMeta: (url, doArchive) =>
        fetch(`${API_URL}/fetch-meta`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, archive: doArchive }),
        }).then(handleResponse),

    saveBookmark: (data) =>
        fetch(`${API_URL}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        }).then(handleResponse),

    bulkFetch: (ids, archive) =>
        fetch(`${API_URL}/bookmarks/bulk-fetch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, archive }),
        }).then(handleResponse),

    moveBookmarks: (ids, folder_id) =>
        fetch(`${API_URL}/bookmarks/bulk-move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, folder_id }),
        }).then(handleResponse),

    // ADD THIS FOR FOLDERS:
    moveFolders: (ids, target_parent_id) =>
        fetch(`${API_URL}/folders/bulk-move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, target_parent_id }),
        }).then(handleResponse),

    saveOrder: (folder_id, items) =>
        fetch(`${API_URL}/folder/order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id, items }),
        }).then(handleResponse),

    getOrder: (folder_id) => 
    fetch(`${API_URL}/${folder_id ? `folder/${folder_id}/order` : 'root/order'}`)
    .then(handleResponse),


    bulkCopyBookmarks: (ids, folder_id, vault) => 
    fetch(`${API_URL}/bookmarks/bulk-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, folder_id, vault }),
    }).then(handleResponse),

  bulkTagBookmarks: (ids, add, remove) => 
    fetch(`${API_URL}/bookmarks/bulk-tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, add, remove }),
    }).then(handleResponse),
bulkDeleteItems: (bookmarkIds, folderIds) => 
    fetch(`${API_URL}/items/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmark_ids: bookmarkIds, folder_ids: folderIds }),
    }).then(handleResponse),

};