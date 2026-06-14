// src/store.js
import { create } from 'zustand';
import { api } from './api';
import { arrayMove } from '@dnd-kit/sortable';
export const useStore = create((set, get) => ({
    // --- State ---
    bookmarks: [],
    vaults: [],
    activeVault: 'default',
    folders: [],
    isLoading: true,
    error: null,

    // View & Filter State
    currentFilter: { type: 'all', value: null }, // type: 'all' | 'vault' | 'folder' | 'tag' | 'archived' | 'screenshot'
    viewMode: 'grid', // 'grid' | 'list'
    sortMode: 'manual',
    searchQuery: '',

    // Selection State
    selectedBookmarks: new Set(),
    selectedFolders: new Set(),
    // Modal State
    detailBookmark: null,
    setDetailBookmark: (bm) => set({ detailBookmark: bm }),
    // ADD THESE TWO LINES:
    archiveViewBookmark: null,
    setArchiveViewBookmark: (bm) => set({ archiveViewBookmark: bm }),

    // Modal Toggles
    isNewFolderOpen: false,
    setNewFolderOpen: (isOpen) => set({ isNewFolderOpen: isOpen }),

    isNewBookmarkOpen: false,
    setNewBookmarkOpen: (isOpen) => set({ isNewBookmarkOpen: isOpen }),

    isBulkFetchOpen: false,
    setBulkFetchOpen: (isOpen) => set({ isBulkFetchOpen: isOpen }),

    targetFetchIds: [],
    setTargetFetchIds: (ids) => set({ targetFetchIds: ids }),

    // Data Injection (Optimistic Updates)
    addFolder: (folder) => set(state => ({ folders: [...state.folders, folder] })),
    addBookmark: (bookmark) => set(state => ({ bookmarks: [bookmark, ...state.bookmarks] })),
    // Sidebar Toggles (Loaded from localStorage)
    sidebarPrimaryView: localStorage.getItem("pb_sidebar_primary") || "folders",
    sidebarTagsView: localStorage.getItem("pb_sidebar_tags") === "true",

    // --- Actions ---

    // Boot up the dashboard
    loadInitialData: async () => {
        set({ isLoading: true, error: null });
        try {
            const [vaultsData, recentData] = await Promise.all([
                api.getVaults(),
                api.getRecentBookmarks()
            ]);

            const vaultsList = vaultsData.vaults || [];

            // FIX: Fetch folders for EVERY vault, not just the first one!
            const allFolders = [];
            for (const v of vaultsList) {
                const folderTree = await api.getFolderTree(v.name);
                allFolders.push(...folderTree);
            }

            set({
                vaults: vaultsList,
                bookmarks: recentData.bookmarks || [],
                folders: allFolders,
                activeVault: vaultsList[0]?.name || "default", // <--- ADD THIS
                isLoading: false
            });
        } catch (err) {
            set({ error: err.message, isLoading: false });
        }
    },

    // Filter & View Actions
    setFilter: (type, value = null) => set(state => {
        let newVault = state.activeVault;
        
        // If we click a specific vault or folder, update our active memory
        if (type === 'vault') newVault = value;
        else if (type === 'folder') {
            const f = state.folders.find(fol => fol.id === value);
            if (f) newVault = f.vault;
        }
        
        // If we click 'root', newVault safely stays exactly what it was!
        return { 
            currentFilter: { type, value }, 
            searchQuery: '', 
            selectedBookmarks: new Set(), 
            selectedFolders: new Set(),
            activeVault: newVault 
        };
    }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setSortMode: (mode) => set({ sortMode: mode }),

    // Sidebar Actions
    setSidebarPrimaryView: (view) => {
        localStorage.setItem("pb_sidebar_primary", view);
        set({ sidebarPrimaryView: view });
    },
    toggleSidebarTags: () => {
        const nextState = !get().sidebarTagsView;
        localStorage.setItem("pb_sidebar_tags", nextState);
        set({ sidebarTagsView: nextState });
    },

    // Selection Actions
    toggleBookmarkSelection: (id) => {
        const next = new Set(get().selectedBookmarks);
        if (next.has(id)) next.delete(id); else next.add(id);
        set({ selectedBookmarks: next });
    },
    toggleFolderSelection: (id) => {
        const next = new Set(get().selectedFolders);
        if (next.has(id)) next.delete(id); else next.add(id);
        set({ selectedFolders: next });
    },
    clearSelection: () => set({ selectedBookmarks: new Set(), selectedFolders: new Set() }),
    setSelection: (bookmarkIds, folderIds) => set({
        selectedBookmarks: new Set(bookmarkIds),
        selectedFolders: new Set(folderIds)
    }),

    moveItemsToFolder: async (bookmarkIds, folderIds, targetFolderId) => {
        // 1. Optimistic UI Update: Instantly update BOTH bookmarks and folders
        set(state => ({
            bookmarks: state.bookmarks.map(bm =>
                bookmarkIds.includes(bm.id) ? { ...bm, folder_id: targetFolderId } : bm
            ),
            folders: state.folders.map(f =>
                folderIds.includes(f.id) ? { ...f, parent_id: targetFolderId } : f
            ),
            // Automatically clear all selections after a successful move
            selectedBookmarks: new Set(),
            selectedFolders: new Set()
        }));

        // 2. Background Server Sync (Fire both APIs simultaneously if needed)
        try {
            const promises = [];
            if (bookmarkIds.length > 0) promises.push(api.moveBookmarks(bookmarkIds, targetFolderId));
            if (folderIds.length > 0) promises.push(api.moveFolders(folderIds, targetFolderId));

            await Promise.all(promises);
        } catch (err) {
            alert("Failed to move items: " + err.message);
            // In a production app, you'd re-fetch the folders/bookmarks here to revert the UI on failure
        }
    },

    // Universal Reorder (Handles Folders & Bookmarks interleaved)
    reorderItems: async (activeId, overId) => {
        const state = get();
        const currentFolderId = state.currentFilter.type === 'folder' ? state.currentFilter.value : null;

        // 1. Get all items in the current view
        const f = state.folders.filter(fol => (fol.parent_id || null) === currentFolderId);
        const b = state.bookmarks.filter(bm => (bm.folder_id || null) === currentFolderId);

        // 2. Combine and sort by current position
        let combined = [...f, ...b].sort((x, y) => (x.position ?? 999999) - (y.position ?? 999999));

        const oldIndex = combined.findIndex(item => item.id === activeId);
        const newIndex = combined.findIndex(item => item.id === overId);

        if (oldIndex === -1 || newIndex === -1) return;

        // 3. Move the array in memory
        combined = arrayMove(combined, oldIndex, newIndex);

        // 4. Generate new positions locally so the UI doesn't snap back!
        const GAP = 1000;
        const updatedBookmarks = [...state.bookmarks];
        const updatedFolders = [...state.folders];
        const payload = [];

        combined.forEach((item, index) => {
            const newPos = (index + 1) * GAP;

            if (item.parent_id !== undefined) { // It's a Folder
                const idx = updatedFolders.findIndex(f => f.id === item.id);
                if (idx > -1) updatedFolders[idx] = { ...updatedFolders[idx], position: newPos };
                payload.push({ item_id: item.id, item_type: 'folder' });
            } else { // It's a Bookmark
                const idx = updatedBookmarks.findIndex(b => b.id === item.id);
                if (idx > -1) updatedBookmarks[idx] = { ...updatedBookmarks[idx], position: newPos };
                payload.push({ item_id: item.id, item_type: 'bookmark' });
            }
        });

        // 5. Instantly update UI
        set({ bookmarks: updatedBookmarks, folders: updatedFolders, sortMode: 'manual' });

        // 6. Sync with server
        try {
            await api.saveOrder(currentFolderId, payload);
        } catch (err) {
            console.error("Failed to save order:", err);
        }
    },

    applyOrder: (items) => set(state => {
        // Create a fast lookup map: "bookmark-123" -> 1000.0
        const orderMap = new Map(items.map(i => [`${i.item_type}-${i.item_id}`, i.position]));

        return {
            bookmarks: state.bookmarks.map(b =>
                orderMap.has(`bookmark-${b.id}`) ? { ...b, position: orderMap.get(`bookmark-${b.id}`) } : b
            ),
            folders: state.folders.map(f =>
                orderMap.has(`folder-${f.id}`) ? { ...f, position: orderMap.get(`folder-${f.id}`) } : f
            )
        };
    }),


    // Modal Toggles
    isMassCopyOpen: false,
    setMassCopyOpen: (isOpen) => set({ isMassCopyOpen: isOpen }),
    isMassTaggerOpen: false,
    setMassTaggerOpen: (isOpen) => set({ isMassTaggerOpen: isOpen }),
    isMassMoveOpen: false,
    setMassMoveOpen: (isOpen) => set({ isMassMoveOpen: isOpen }),

    // Execution Functions
    executeBulkCopy: async (targetFolderId, targetVault) => {
        const state = get();
        const bIds = Array.from(state.selectedBookmarks);
        if (bIds.length === 0) return;

        try {
            const res = await api.bulkCopyBookmarks(bIds, targetFolderId, targetVault);
            set({
                bookmarks: [...state.bookmarks, ...res.bookmarks],
                selectedBookmarks: new Set(),
                selectedFolders: new Set(), // Clear all selections
                isMassCopyOpen: false
            });
        } catch (err) {
            alert("Failed to copy: " + err.message);
        }
    },

    executeBulkTag: async (addTagsStr, removeTagsStr) => {
        const state = get();
        const bIds = Array.from(state.selectedBookmarks);
        if (bIds.length === 0) return;

        // Clean up comma-separated strings into arrays
        const addTags = addTagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const removeTags = removeTagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        try {
            await api.bulkTagBookmarks(bIds, addTags, removeTags);

            // Optimistic UI Update for Tags
            set(state => ({
                bookmarks: state.bookmarks.map(b => {
                    if (bIds.includes(b.id)) {
                        let newTags = [...(b.tags || [])];
                        newTags = newTags.filter(t => !removeTags.includes(t)); // Remove
                        addTags.forEach(t => { if (!newTags.includes(t)) newTags.push(t); }); // Add
                        return { ...b, tags: newTags };
                    }
                    return b;
                }),
                selectedBookmarks: new Set(),
                selectedFolders: new Set(),
                isMassTaggerOpen: false
            }));
        } catch (err) {
            alert("Failed to tag: " + err.message);
        }
    },

    executeBulkDelete: async () => {
        const state = get();
        const bIds = Array.from(state.selectedBookmarks);
        const fIds = Array.from(state.selectedFolders);

        if (bIds.length === 0 && fIds.length === 0) return;

        // Native browser prompt window
        const msg = `Are you sure you want to permanently delete ${bIds.length} bookmark(s) and ${fIds.length} folder(s)?`;
        if (!window.confirm(msg)) return;

        try {
            await api.bulkDeleteItems(bIds, fIds);

            // Wipe items from current app memory layout state
            set(state => ({
                bookmarks: state.bookmarks.filter(b => !bIds.includes(b.id)),
                folders: state.folders.filter(f => !fIds.includes(f.id)),
                selectedBookmarks: new Set(),
                selectedFolders: new Set()
            }));
        } catch (err) {
            alert("Failed to delete items: " + err.message);
        }
    },


}));