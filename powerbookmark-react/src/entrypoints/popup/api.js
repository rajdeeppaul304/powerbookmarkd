// Re-export dashboard api, or just duplicate the base URL here
export const API_URL = "http://127.0.0.1:8765";

const handle = async (res) => {
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "API request failed");
    }
    return res.json();
};

export const api = {
    getHealth: () => fetch(`${API_URL}/health`).then(handle),
    getVaults: () => fetch(`${API_URL}/vaults`).then(handle),
    getContents: (vault, folderId = null) => {
        const p = new URLSearchParams({ vault });
        if (folderId) p.set("folder_id", folderId);
        return fetch(`${API_URL}/contents?${p}`).then(handle);
    },
    getFolderPath: (folderId) =>
        fetch(`${API_URL}/folders/${folderId}/path`).then(handle),
    lookupUrl: (url) =>
        fetch(`${API_URL}/lookup?url=${encodeURIComponent(url)}`).then(handle),
    getBookmark: (id) =>
        fetch(`${API_URL}/bookmark/${id}`).then(handle),
    search: (q, vault, folderId, limit = 50) => {
        const p = new URLSearchParams({ q, vault, limit });
        if (folderId) p.set("folder_id", folderId);
        return fetch(`${API_URL}/search?${p}`).then(handle);
    },
    getRecentBookmarks: (limit = 500) =>
    fetch(`${API_URL}/recent?limit=${limit}`).then(handle),

getFolderPath: (folderId) =>
    fetch(`${API_URL}/folders/${folderId}/path`).then(handle),


};