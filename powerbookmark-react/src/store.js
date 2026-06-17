// src/store.js
import { create } from 'zustand';
import { api } from './api';
import { arrayMove } from '@dnd-kit/sortable';
export const useStore = create((set, get) => ({
    // --- State ---
    bookmarks: [],
    vaults: [],
    folders: [],
    isLoading: true,
    error: null,
    contextMenu: null,
    skipDeleteConfirmation: localStorage.getItem('pb_skip_delete_confirm') === 'true',
    pendingDeletionPayload: null, // Holds { bookmarkIds: [], folderIds: [] } when modal is open

    jobs: [],

    undoStack: [],
    redoStack: [],

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
    isEditingDetails: false,
    setDetailBookmark: (bm, edit = false) => set({ detailBookmark: bm, isEditingDetails: edit }),
    setEditingDetails: (isEditing) => set({ isEditingDetails: isEditing }), // <--- ADD THIS
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

    defaultVault: localStorage.getItem('pb_default_vault') || 'default',
    activeVault: localStorage.getItem('pb_default_vault') || 'default', // <--- Update this line
    viewMode: localStorage.getItem('pb_view_mode') || 'grid',

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
            const storedDefault = get().defaultVault;
            const vaultToSet = vaultsList.some(v => v.name === storedDefault)
                ? storedDefault
                : (vaultsList[0]?.name || "default");

            set({
                vaults: vaultsList,
                bookmarks: recentData.bookmarks || [],
                folders: allFolders,
                activeVault: vaultToSet, // <--- ADD THIS
                currentFilter: { type: 'vault', value: vaultToSet },
                isLoading: false
            });
        } catch (err) {
            set({ error: err.message, isLoading: false });
        }
    },



    // The Silent Heartbeat Sync
    silentSync: async () => {
        try {
            // 1. Fetch fresh data quietly in the background
            const [vaultsData, recentData] = await Promise.all([
                api.getVaults(),
                api.getRecentBookmarks()
            ]);

            const vaultsList = vaultsData.vaults || [];
            const allFolders = [];
            for (const v of vaultsList) {
                const folderTree = await api.getFolderTree(v.name);
                allFolders.push(...folderTree);
            }

            // 2. Perform the Surgical Merge
            set(state => {
                // Merge Bookmarks
                const currentBms = new Map(state.bookmarks.map(b => [b.id, b]));
                const incomingBms = recentData.bookmarks || [];

                const mergedBookmarks = incomingBms.map(newBm => {
                    const oldBm = currentBms.get(newBm.id);
                    if (oldBm) {
                        newBm.position = oldBm.position; // <--- PRESERVE THE LOCAL POSITION
                        if (JSON.stringify(oldBm) === JSON.stringify(newBm)) return oldBm;
                    }
                    return newBm;
                });

                // Merge Folders
                const currentFols = new Map(state.folders.map(f => [f.id, f]));
                const mergedFolders = allFolders.map(newFol => {
                    const oldFol = currentFols.get(newFol.id);
                    if (oldFol) {
                        newFol.position = oldFol.position; // <--- PRESERVE THE LOCAL POSITION
                        if (JSON.stringify(oldFol) === JSON.stringify(newFol)) return oldFol;
                    }
                    return newFol;
                });

                // 3. Safety Check: If an item was deleted on another tab, 
                // silently remove it from our active selections!
                const activeBmIds = new Set(mergedBookmarks.map(b => b.id));
                const activeFolIds = new Set(mergedFolders.map(f => f.id));

                const safeSelectedBms = new Set([...state.selectedBookmarks].filter(id => activeBmIds.has(id)));
                const safeSelectedFols = new Set([...state.selectedFolders].filter(id => activeFolIds.has(id)));

                return {
                    vaults: vaultsList,
                    bookmarks: mergedBookmarks,
                    folders: mergedFolders,
                    selectedBookmarks: safeSelectedBms,
                    selectedFolders: safeSelectedFols
                };
            });
        } catch (err) {
            // If the backend goes down briefly, just ignore it. No need to throw red errors.
            console.warn("Background sync paused: Server unreachable");
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
        await get()._executeMove(bookmarkIds, folderIds, targetFolderId);
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

    // executeBulkDelete: async () => {
    //     const state = get();
    //     const bIds = Array.from(state.selectedBookmarks);
    //     const fIds = Array.from(state.selectedFolders);

    //     if (bIds.length === 0 && fIds.length === 0) return;

    //     // Native browser prompt window
    //     const msg = `Are you sure you want to permanently delete ${bIds.length} bookmark(s) and ${fIds.length} folder(s)?`;
    //     if (!window.confirm(msg)) return;

    //     try {
    //         await api.bulkDeleteItems(bIds, fIds);

    //         // Wipe items from current app memory layout state
    //         set(state => ({
    //             bookmarks: state.bookmarks.filter(b => !bIds.includes(b.id)),
    //             folders: state.folders.filter(f => !fIds.includes(f.id)),
    //             selectedBookmarks: new Set(),
    //             selectedFolders: new Set()
    //         }));
    //     } catch (err) {
    //         alert("Failed to delete items: " + err.message);
    //     }
    // },

    setDefaultVault: (vaultName) => {
        localStorage.setItem('pb_default_vault', vaultName);
        set({ defaultVault: vaultName });
    },
    setViewMode: (mode) => {
        localStorage.setItem('pb_view_mode', mode);
        set({ viewMode: mode });
    },


    renameFolder: async (id, oldName) => {
        const newName = window.prompt("Rename folder to:", oldName);
        if (!newName || newName.trim() === "" || newName === oldName) return;

        set(state => ({
            folders: state.folders.map(f => f.id === id ? { ...f, name: newName.trim() } : f)
        }));

        try {
            await api.renameFolder(id, newName.trim());
            get()._pushUndo({
                type: 'rename',
                folderId: id,
                oldName,
                newName: newName.trim()
            });
        } catch (err) {
            alert("Failed to rename folder: " + err.message);
            get().loadInitialData();
        }
    },

    saveBookmarkEdits: async (id, data) => {
        // 1. Optimistic UI Update (Instant!)
        set(state => ({
            bookmarks: state.bookmarks.map(b => b.id === id ? { ...b, ...data } : b),
            detailBookmark: { ...state.detailBookmark, ...data },
            isEditingDetails: false // Close edit mode
        }));

        // 2. Background Sync
        try {
            await api.updateBookmark(id, data);
        } catch (err) {
            alert("Failed to save edits: " + err.message);
            get().loadInitialData(); // Revert on failure
        }
    },


    fetchJobsStatus: async () => {
        try {
            const res = await api.getJobs();
            set({ jobs: res.jobs || [] });
        } catch (err) {
            console.error("Failed to fetch jobs");
        }
    },

    controlJob: async (jobId, action) => {
        try {
            await api.controlJob(jobId, action);
            get().fetchJobsStatus(); // Refresh UI instantly
        } catch (err) {
            alert("Action failed: " + err.message);
        }
    },
    setContextMenu: (menuData) => set({ contextMenu: menuData }),

    // --- Delete Actions ---
    setSkipDeleteConfirmation: (skip) => {
        localStorage.setItem('pb_skip_delete_confirm', skip);
        set({ skipDeleteConfirmation: skip });
    },

    // The Universal Funnel: ALL deletes go through here
    requestDeletion: (payload) => {
        const { skipDeleteConfirmation } = get();
        if (skipDeleteConfirmation) {
            get()._executeDeletion(payload);
        } else {
            set({ pendingDeletionPayload: payload });
        }
    },

    cancelDeletion: () => set({ pendingDeletionPayload: null }),

    confirmDeletion: (rememberPreference = false) => {
        if (rememberPreference) {
            get().setSkipDeleteConfirmation(true);
        }
        const payload = get().pendingDeletionPayload;
        set({ pendingDeletionPayload: null });
        if (payload) get()._executeDeletion(payload);
    },

    // The Engine: Handles the actual API call and UI optimistic updates
    _executeDeletion: async ({ bookmarkIds = [], folderIds = [] }) => {
        if (bookmarkIds.length === 0 && folderIds.length === 0) return;

        try {
            const result = await api.bulkDeleteItems(bookmarkIds, folderIds);

            const deletedBIds = new Set(result.deleted_bookmark_ids);
            const deletedFIds = new Set(result.deleted_folder_ids);

            set(state => ({
                bookmarks: state.bookmarks.filter(b => !deletedBIds.has(b.id)),
                folders: state.folders.filter(f => !deletedFIds.has(f.id)),
                selectedBookmarks: new Set(),
                selectedFolders: new Set()
            }));

            // Push to undo stack after confirmed success
            get()._pushUndo({
                type: 'delete',
                trashId: result.trash_id,
                deletedBookmarkIds: result.deleted_bookmark_ids,
                deletedFolderIds: result.deleted_folder_ids,
            });

        } catch (err) {
            alert("Failed to delete items: " + err.message);
        }
    },


    // --- Clipboard State ---
    // Format: { action: 'copy' | 'cut', payload: { bookmarkIds: [], folderIds: [] } }
    clipboard: null,

    // --- Clipboard Actions ---
    setClipboard: (action, payload) => set({ clipboard: { action, payload } }),
    clearClipboard: () => set({ clipboard: null }),


_executeMove: async (bookmarkIds, folderIds, targetFolderId) => {
    const state = get();

    // --- CLIENT-SIDE CYCLE GUARD ---
    // Check if targetFolderId is the same as, or a descendant of, any folder being moved.
    // If so, reject BEFORE applying any optimistic update — otherwise we create
    // a cycle in the in-memory folders array that can freeze the whole app
    // (e.g. any code that walks parent_id chains, like breadcrumbs).
    const isDescendant = (candidateId, ancestorId) => {
        let current = candidateId;
        const seen = new Set();
        while (current) {
            if (current === ancestorId) return true;
            if (seen.has(current)) return false; // safety, shouldn't happen on clean data
            seen.add(current);
            const f = state.folders.find(f => f.id === current);
            current = f?.parent_id ?? null;
        }
        return false;
    };

    if (targetFolderId !== null) {
        for (const fid of folderIds) {
            if (targetFolderId === fid || isDescendant(targetFolderId, fid)) {
                alert("Cannot move a folder into itself or one of its descendants");
                return;
            }
        }
    }

        const originalFolderId = state.bookmarks.find(b => b.id === bookmarkIds[0])?.folder_id ??
            state.folders.find(f => f.id === folderIds[0])?.parent_id ?? null;

        set(state => ({
            bookmarks: state.bookmarks.map(b =>
                bookmarkIds.includes(b.id) ? { ...b, folder_id: targetFolderId } : b
            ),
            folders: state.folders.map(f =>
                folderIds.includes(f.id) ? { ...f, parent_id: targetFolderId } : f
            ),
            selectedBookmarks: new Set(),
            selectedFolders: new Set()
        }));

        try {
            await api.bulkMoveItems(bookmarkIds, folderIds, targetFolderId);
            get()._pushUndo({
                type: 'move',
                bookmarkIds,
                folderIds,
                originalFolderId,
                targetFolderId
            });
        } catch (err) {
            alert("Failed to move items: " + err.message);
            get().loadInitialData();
        }
    },


    // --- Paste Execution ---
    executePaste: async (targetFolderId) => {
        const state = get();
        const { clipboard, activeVault } = state;

        if (!clipboard) return;

        const { action, payload } = clipboard;
        const { bookmarkIds, folderIds } = payload;

        if (bookmarkIds.length === 0 && folderIds.length === 0) return;

        // ==========================================
        // CUT (MOVE) LOGIC
        // ==========================================
        if (action === 'cut') {
            set({ clipboard: null });
            await get()._executeMove(bookmarkIds, folderIds, targetFolderId);
        }

        // ==========================================
        // COPY LOGIC
        // ==========================================
        if (action === 'copy') {
            try {
                const res = await api.bulkCopyItems(bookmarkIds, folderIds, targetFolderId, activeVault);

                set(state => ({
                    bookmarks: [...state.bookmarks, ...(res.new_bookmarks || [])],
                    folders: [...state.folders, ...(res.new_folders || [])],
                    selectedBookmarks: new Set(),
                    selectedFolders: new Set()
                }));

                // Push after success
                get()._pushUndo({
                    type: 'copy',
                    copiedBookmarkIds: (res.new_bookmarks || []).map(b => b.id),
                    copiedFolderIds: (res.new_folders || []).map(f => f.id),
                });

            } catch (err) {
                alert("Failed to copy items: " + err.message);
            }
        }
    },

    _loadUndoStack: () => {
        try {
            const saved = sessionStorage.getItem('pb_undo_stack');
            if (saved) set({ undoStack: JSON.parse(saved) });
        } catch { }
    },

    _pushUndo: (entry) => {
        const stack = [...get().undoStack, entry].slice(-30);
        sessionStorage.setItem('pb_undo_stack', JSON.stringify(stack));
        set({ undoStack: stack, redoStack: [] });
    },

    undo: async () => {
        const stack = [...get().undoStack];
        if (!stack.length) return;

        const entry = stack.pop();
        sessionStorage.setItem('pb_undo_stack', JSON.stringify(stack));
        set({ undoStack: stack });

        try {
            if (entry.type === 'delete') {
                await api.restoreTrash([entry.trashId]);
                // Let silentSync pick up the restored items naturally
                // since we don't have the full bookmark/folder objects in the undo entry
                await get().silentSync();
            }
            if (entry.type === 'move') {
                await api.bulkMoveItems(
                    entry.bookmarkIds,
                    entry.folderIds,
                    entry.originalFolderId
                );
                set(state => ({
                    bookmarks: state.bookmarks.map(b =>
                        entry.bookmarkIds.includes(b.id)
                            ? { ...b, folder_id: entry.originalFolderId }
                            : b
                    ),
                    folders: state.folders.map(f =>
                        entry.folderIds.includes(f.id)
                            ? { ...f, parent_id: entry.originalFolderId }
                            : f
                    )
                }));
            }

            if (entry.type === 'copy') {
                const result = await api.bulkDeleteItems(
                    entry.copiedBookmarkIds,
                    entry.copiedFolderIds
                );
                set(state => ({
                    bookmarks: state.bookmarks.filter(b => !entry.copiedBookmarkIds.includes(b.id)),
                    folders: state.folders.filter(f => !entry.copiedFolderIds.includes(f.id)),
                }));
                // Store trash_id for redo
                entry.trashId = result.trash_id;
            }

            if (entry.type === 'rename') {
                await api.renameFolder(entry.folderId, entry.oldName);
                set(state => ({
                    folders: state.folders.map(f =>
                        f.id === entry.folderId ? { ...f, name: entry.oldName } : f
                    )
                }));
            }

            // push to redo stack after success
            const redoStack = [...get().redoStack, entry].slice(-30);
            sessionStorage.setItem('pb_redo_stack', JSON.stringify(redoStack));
            set({ redoStack });

        } catch (err) {
            alert("Couldn't undo: " + err.message);
        }
    },

    redo: async () => {
        const redoStack = [...get().redoStack];
        if (!redoStack.length) return;

        const entry = redoStack.pop();
        sessionStorage.setItem('pb_redo_stack', JSON.stringify(redoStack));
        set({ redoStack });

        try {
            if (entry.type === 'delete') {
                const result = await api.bulkDeleteItems(
                    entry.deletedBookmarkIds,
                    entry.deletedFolderIds
                );
                // Update trash_id since redo creates a new trash entry
                entry.trashId = result.trash_id;

                set(state => ({
                    bookmarks: state.bookmarks.filter(b => !entry.deletedBookmarkIds.includes(b.id)),
                    folders: state.folders.filter(f => !entry.deletedFolderIds.includes(f.id)),
                }));
            }


            if (entry.type === 'move') {
                await api.bulkMoveItems(
                    entry.bookmarkIds,
                    entry.folderIds,
                    entry.targetFolderId
                );
                set(state => ({
                    bookmarks: state.bookmarks.map(b =>
                        entry.bookmarkIds.includes(b.id)
                            ? { ...b, folder_id: entry.targetFolderId }
                            : b
                    ),
                    folders: state.folders.map(f =>
                        entry.folderIds.includes(f.id)
                            ? { ...f, parent_id: entry.targetFolderId }
                            : f
                    )
                }));
            }

            if (entry.type === 'copy') {
                await api.restoreTrash([entry.trashId]);
                await get().silentSync();
            }

            if (entry.type === 'rename') {
                await api.renameFolder(entry.folderId, entry.newName);
                set(state => ({
                    folders: state.folders.map(f =>
                        f.id === entry.folderId ? { ...f, name: entry.newName } : f
                    )
                }));
            }

            // push back to undo stack after successful redo
            const undoStack = [...get().undoStack, entry].slice(-30);
            set({ undoStack });
            sessionStorage.setItem('pb_undo_stack', JSON.stringify(undoStack));

        } catch (err) {
            alert("Couldn't redo: " + err.message);
        }
    },

}));