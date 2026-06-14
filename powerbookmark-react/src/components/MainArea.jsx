// src/components/MainArea.jsx
import React, { useMemo, useEffect } from 'react'; // <--- Added React here!
import { useStore } from '../store';
import BookmarkCard from './BookmarkCard';
import BookmarkRow from './BookmarkRow'; // <--- Import it
import FolderCard from './FolderCard'; // <--- NEW
import FolderRow from './FolderRow'; // <--- NEW
import { useDroppable } from '@dnd-kit/core'; // <--- ADD THIS
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api } from '../api';


// Mini component for our interactive breadcrumbs
function DroppableCrumb({ folderId, name, isLast }) {
    const { setFilter } = useStore();
    const { setNodeRef, isOver } = useDroppable({
        id: `drop-crumb-${folderId || 'root'}`,
        data: { type: 'folder', id: folderId } // null folderId = Root!
    });

    return (
        <span
            ref={setNodeRef}
            onClick={() => setFilter(folderId ? 'folder' : 'root', folderId)}
            style={{
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '6px',
                backgroundColor: isOver ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: isOver ? 'var(--blue)' : (isLast ? 'var(--text)' : 'var(--text2)'),
                fontWeight: isLast ? 600 : 500,
                transition: 'background-color 0.2s'
            }}
        >
            {name}
        </span>
    );
}

export default function MainArea() {
    const { bookmarks, folders, currentFilter, activeVault, sortMode, setSortMode, searchQuery, viewMode, selectedBookmarks, selectedFolders, setSelection, clearSelection,
        renameFolder, setDetailBookmark } = useStore();


    // Instantly fetch the correct DB order for this specific view!
    useEffect(() => {
        if (currentFilter.type === 'folder' || currentFilter.type === 'root' || currentFilter.type === 'vault') {
            const folderId = currentFilter.type === 'folder' ? currentFilter.value : null;
            api.getOrder(folderId).then(data => {
                useStore.getState().applyOrder(data.items);
            }).catch(err => console.error("Could not fetch order:", err));
        }
    }, [currentFilter.value, currentFilter.type]);
    // This block completely replaces your vanilla `getFiltered()` function!
    // useMemo ensures it only recalculates when bookmarks, filter, sort, or search changes.

    // --- F2 KEYBOARD SHORTCUT ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Safety: Don't trigger if the user is typing in a search bar, input, or textarea
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;

            if (e.key === 'F2') {
                e.preventDefault(); // Stop default browser F2 actions

                if (selectedFolders.size === 1 && selectedBookmarks.size === 0) {
                    // Rename Folder
                    const folderId = Array.from(selectedFolders)[0];
                    const folder = folders.find(f => f.id === folderId);
                    if (folder) renameFolder(folder.id, folder.name);

                } else if (selectedBookmarks.size === 1 && selectedFolders.size === 0) {
                    // Edit Bookmark
                    const bmId = Array.from(selectedBookmarks)[0];
                    const bm = bookmarks.find(b => b.id === bmId);
                    if (bm) setDetailBookmark(bm, true); // true = open in Edit Mode
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedBookmarks, selectedFolders, folders, bookmarks, renameFolder, setDetailBookmark]);
    const filteredBookmarks = useMemo(() => {
        let items = [...bookmarks];

        // Root only shows items explicitly at the base level OF THE ACTIVE VAULT
        if (currentFilter.type === "root") items = items.filter(b => !b.folder_id && b.vault === activeVault);

        // Vault only shows base level items inside that vault
        if (currentFilter.type === "vault") items = items.filter(b => b.vault === currentFilter.value && !b.folder_id);

        // Filters
        if (currentFilter.type === "archived") items = items.filter(b => b.archived);
        if (currentFilter.type === "screenshot") items = items.filter(b => b.screenshot);        // if (currentFilter.type === "vault") items = items.filter(b => b.vault === currentFilter.value);
        if (currentFilter.type === "tag") items = items.filter(b => (b.tags || []).includes(currentFilter.value));
        if (currentFilter.type === "folder") items = items.filter(b => b.folder_id === currentFilter.value);

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(b =>
                (b.title || "").toLowerCase().includes(q) ||
                (b.url || "").toLowerCase().includes(q) ||
                (b.notes || "").toLowerCase().includes(q) ||
                (b.tags || []).some(t => t.toLowerCase().includes(q))
            );
        }

        // Sort
        switch (sortMode) {
            case "date-asc": items.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")); break;
            case "date-desc": items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); break;
            case "title": items.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url)); break;
            case "manual": break; // <--- ADD THIS: Do nothing! Trust the exact array order.
        }

        return items;
    }, [bookmarks, currentFilter, searchQuery, sortMode]);


    const filteredFolders = useMemo(() => {
        // We only show folders if we are in "all", "vault", or a specific "folder"
        if (['archived', 'screenshot', 'tag', 'all'].includes(currentFilter.type)) return []; // <--- "all" has no folders

        if (currentFilter.type === 'vault') {
            return folders.filter(f => f.vault === currentFilter.value && !f.parent_id); // Show root folders of vault
        }

        if (currentFilter.type === 'folder') {
            return folders.filter(f => f.parent_id === currentFilter.value); // Show subfolders
        }

        if (currentFilter.type === 'root') return folders.filter(f => !f.parent_id && f.vault === activeVault);
        // "All" view shows root folders
        return folders.filter(f => !f.parent_id);
    }, [folders, currentFilter]);


    const interleavedItems = useMemo(() => {
        // Combine both arrays
        const items = [...filteredFolders, ...filteredBookmarks];
        // Sort them by the backend's 'position' float. If they don't have one yet, put them at the bottom (999999).
        return items.sort((a, b) => (a.position ?? 999999) - (b.position ?? 999999));
    }, [filteredFolders, filteredBookmarks]);


    // Dynamic titles based on filter
    const getHeaderTitle = () => {
        if (currentFilter.type === 'archived') return 'Archived';
        if (currentFilter.type === 'screenshot') return 'With Screenshot';
        if (currentFilter.type === 'vault') return `Vault: ${currentFilter.value}`;
        if (currentFilter.type === 'tag') return `Tag: #${currentFilter.value}`;
        if (currentFilter.type === 'folder') return `Folder View`; // We'll map the ID to name later
        return 'All Bookmarks';
    };
    // --- Breadcrumb Math ---
    const breadcrumbs = useMemo(() => {
        if (currentFilter.type !== 'folder') return [];
        const path = [];
        let currentId = currentFilter.value;

        // Trace the tree backward to root
        while (currentId) {
            const f = folders.find(f => f.id === currentId);
            if (!f) break;
            path.unshift(f);
            currentId = f.parent_id;
        }
        return path;
    }, [currentFilter, folders]);

    const handleBack = () => {
        if (breadcrumbs.length > 1) {
            setFilter('folder', breadcrumbs[breadcrumbs.length - 2].id);
        } else {
            setFilter('root'); // Go back to root, not all!
        }
    };

    const handleSelectAll = () => {
        const visibleBIds = filteredBookmarks.map(b => b.id);
        const visibleFIds = filteredFolders.map(f => f.id);

        // Check if every visible item is currently in the Sets
        const allBookmarksSelected = visibleBIds.every(id => selectedBookmarks.has(id));
        const allFoldersSelected = visibleFIds.every(id => selectedFolders.has(id));
        const isAllSelected = (visibleBIds.length > 0 || visibleFIds.length > 0) && allBookmarksSelected && allFoldersSelected;

        if (isAllSelected) {
            clearSelection();
        } else {
            setSelection(visibleBIds, visibleFIds);
        }
    };

    // Calculate text for the button dynamically
    const allSelected = (filteredBookmarks.length > 0 || filteredFolders.length > 0) &&
        filteredBookmarks.every(b => selectedBookmarks.has(b.id)) &&
        filteredFolders.every(f => selectedFolders.has(f.id));


    return (
        <main className="main">
            <div className="main-header" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '16px', minHeight: '36px' }}>

                {['folder', 'root'].includes(currentFilter.type) ? (
                    <>
                        {currentFilter.type === 'folder' && (
                            <button className="btn btn-secondary" style={{ padding: '4px 12px', flex: '0 0 auto', width: 'auto' }} onClick={handleBack}>
                                ← Back
                            </button>
                        )}
                        <div className="breadcrumbs" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '18px' }}>
                            <DroppableCrumb folderId={null} name="🗂 Root" isLast={breadcrumbs.length === 0} />
                            {breadcrumbs.map((f, index) => (
                                <React.Fragment key={f.id}>
                                    <span style={{ color: 'var(--text3)' }}>/</span>
                                    <DroppableCrumb folderId={f.id} name={`📁 ${f.name}`} isLast={index === breadcrumbs.length - 1} />
                                </React.Fragment>
                            ))}
                        </div>
                    </>
                ) : (
                    <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>
                        {getHeaderTitle()}
                    </div>
                )}
            </div>

            <div className="controls-bar">
                <span className="sort-label">Sort:</span>

                {/* Wrap buttons in a div that handles the greying out */}
                <div style={{
                    display: 'flex', gap: '4px',
                    opacity: viewMode === 'list' ? 0.4 : 1,
                    pointerEvents: viewMode === 'list' ? 'none' : 'auto'
                }}>
                    <button className={`sort-btn ${sortMode === 'date-desc' ? 'active' : ''}`} onClick={() => setSortMode('date-desc')}>Newest</button>
                    <button className={`sort-btn ${sortMode === 'date-asc' ? 'active' : ''}`} onClick={() => setSortMode('date-asc')}>Oldest</button>
                    <button className={`sort-btn ${sortMode === 'title' ? 'active' : ''}`} onClick={() => setSortMode('title')}>Title A–Z</button>
                </div>

                <div className="controls-sep"></div>
                <button
                    className="select-all-btn"
                    onClick={handleSelectAll}
                >
                    {allSelected ? 'Deselect all' : 'Select all'}
                </button>
            </div>

            <div id="bookmarksContainer" style={{ position: 'relative' }}>

                {/* THE FIX: Check if BOTH arrays are empty! */}
                {filteredBookmarks.length === 0 && filteredFolders.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <div className="empty-title">Nothing here</div>
                        <div className="empty-sub">This folder is totally empty.</div>
                    </div>
                ) : (
                    <div className={viewMode === 'grid' ? "bookmarks-grid" : "bookmarks-list"}>

                        {viewMode === 'grid' ? (
                            <>
                                {/* GRID: Folders strictly at the top, then Bookmarks */}
                                {filteredFolders.map(folder => <FolderCard key={`folder-${folder.id}`} folder={folder} />)}
                                {filteredBookmarks.map(bm => <BookmarkCard key={bm.id} bm={bm} />)}
                            </>
                        ) : (
                            /* LIST: Interleaved and Sorted! */
                            <SortableContext items={interleavedItems.map(item => item.id)} strategy={verticalListSortingStrategy}>
                                {interleavedItems.map(item => (
                                    // Check if it's a folder (they have parent_id, bookmarks have folder_id)
                                    item.parent_id !== undefined
                                        ? <FolderRow key={item.id} folder={item} />
                                        : <BookmarkRow key={item.id} bm={item} />
                                ))}
                            </SortableContext>
                        )}

                    </div>
                )}
            </div>
        </main>
    );
}