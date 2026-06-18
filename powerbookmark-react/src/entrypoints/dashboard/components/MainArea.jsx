import React, { useMemo, useEffect, useState, useRef, createContext, useContext } from 'react';
import { useStore } from '../store';
import BookmarkCard from './BookmarkCard';
import BookmarkRow from './BookmarkRow';
import FolderCard from './FolderCard';
import FolderRow from './FolderRow';
import ContextMenu from './ContextMenu';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api } from '../api';

export const SelectionContext = createContext(null);

// Mini component for our interactive breadcrumbs
function DroppableCrumb({ folderId, name, isLast }) {
    const { setFilter, activeTagFilters } = useStore();
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
    const {
        setContextMenu, bookmarks, folders, currentFilter, activeVault, sortMode,
        setSortMode, searchQuery, viewMode, selectedBookmarks, selectedFolders,
        setSelection, clearSelection, renameFolder, setDetailBookmark,
        setNewBookmarkOpen, setNewFolderOpen, activeTagFilters, isVaultUnlocked, setUnlockTarget, vaults,
        clipboard, executePaste // <--- ADDED THESE TWO
    } = useStore();

    const anchorIdRef = useRef(null);
    // Reset anchor on navigation
    useEffect(() => {
        anchorIdRef.current = null;
    }, [currentFilter.value, currentFilter.type]);

    const currentVaultLocked = useMemo(() => {
        if (currentFilter.type !== 'vault') return false;
        const v = vaults.find(v => v.name === currentFilter.value);
        return v?.has_pin && !isVaultUnlocked(currentFilter.value);
    }, [currentFilter, vaults, isVaultUnlocked]);


    // The handler all four components will consume
    const handleItemClick = (id, e) => {
        if (e.shiftKey && anchorIdRef.current && anchorIdRef.current !== id) {
            const ids = visibleItems.map(i => i.id);
            const anchorIdx = ids.indexOf(anchorIdRef.current);
            const clickIdx = ids.indexOf(id);
            if (anchorIdx === -1 || clickIdx === -1) return;

            const [start, end] = anchorIdx < clickIdx
                ? [anchorIdx, clickIdx]
                : [clickIdx, anchorIdx];

            const range = visibleItems.slice(start, end + 1);
            setSelection(
                range.filter(i => !('parent_id' in i)).map(i => i.id),
                range.filter(i => 'parent_id' in i).map(i => i.id)
            );
            // anchor stays at first click, don't update it
        } else {
            anchorIdRef.current = id;
            const isFolder = 'parent_id' in (visibleItems.find(i => i.id === id) ?? {});
            if (isFolder) {
                useStore.getState().toggleFolderSelection(id);
            } else {
                useStore.getState().toggleBookmarkSelection(id);
            }
        }
    };
    // Instantly fetch the correct DB order for this specific view!
    // useEffect(() => {
    //     if (currentFilter.type === 'folder' || currentFilter.type === 'root' || currentFilter.type === 'vault') {
    //         const folderId = currentFilter.type === 'folder' ? currentFilter.value : null;
    //         api.getOrder(folderId).then(data => {
    //             useStore.getState().applyOrder(data.items);
    //         }).catch(err => console.error("Could not fetch order:", err));
    //     }
    // }, [currentFilter.value, currentFilter.type]);


    // --- UPDATED CONTEXT MENU ---
    const handleBackgroundContextMenu = (e) => {
        e.preventDefault();

        // Check if there's actually anything in the clipboard to paste
        const hasItems = clipboard && (clipboard.payload.bookmarkIds.length > 0 || clipboard.payload.folderIds.length > 0);

        // Figure out exactly where the user is trying to paste
        const targetFolderId = currentFilter.type === 'folder' ? currentFilter.value : null;

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            options: [
                { label: '➕ Add Bookmark', action: () => setNewBookmarkOpen(true) },
                { label: '📁 Add Folder', action: () => setNewFolderOpen(true) },
                { separator: true },
                {
                    label: `📋 Paste${clipboard ? (clipboard.action === 'copy' ? ' (Copy)' : ' (Move)') : ''}`,
                    disabled: !hasItems,
                    action: () => {
                        if (hasItems) executePaste(targetFolderId);
                    }
                }
            ]
        });
    };

    // --- F2 KEYBOARD SHORTCUT ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;

            if (e.key === 'F2') {
                e.preventDefault();

                if (selectedFolders.size === 1 && selectedBookmarks.size === 0) {
                    const folderId = Array.from(selectedFolders)[0];
                    const folder = folders.find(f => f.id === folderId);
                    if (folder) renameFolder(folder.id, folder.name);

                } else if (selectedBookmarks.size === 1 && selectedFolders.size === 0) {
                    const bmId = Array.from(selectedBookmarks)[0];
                    const bm = bookmarks.find(b => b.id === bmId);
                    if (bm) setDetailBookmark(bm, true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedBookmarks, selectedFolders, folders, bookmarks, renameFolder, setDetailBookmark]);

    const filteredBookmarks = useMemo(() => {
        let items = [...bookmarks];

        if (currentFilter.type === "root") items = items.filter(b => !b.folder_id && b.vault === activeVault);
        if (currentFilter.type === "vault") items = items.filter(b => b.vault === currentFilter.value && !b.folder_id);
        if (currentFilter.type === "archived") items = items.filter(b => b.archived);
        if (currentFilter.type === "screenshot") items = items.filter(b => b.screenshot);
        if (currentFilter.type === "folder") items = items.filter(b => b.folder_id === currentFilter.value);

        // Tag filter layer
        const { tags, mode } = activeTagFilters;
        if (tags.length > 0) {
            items = items.filter(b => {
                const bTags = b.tags || [];
                return mode === 'and'
                    ? tags.every(t => bTags.includes(t))
                    : tags.some(t => bTags.includes(t));
            });
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(b =>
                (b.title || "").toLowerCase().includes(q) ||
                (b.url || "").toLowerCase().includes(q) ||
                (b.notes || "").toLowerCase().includes(q) ||
                (b.tags || []).some(t => t.toLowerCase().includes(q))
            );
        }

        switch (sortMode) {
            case "date-asc": items.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")); break;
            case "date-desc": items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); break;
            case "title": items.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url)); break;
            case "manual": break;
        }

        return items;
    }, [bookmarks, currentFilter, searchQuery, sortMode, activeVault, activeTagFilters]);

    const filteredFolders = useMemo(() => {
        if (['archived', 'screenshot', 'all'].includes(currentFilter.type)) return [];

        let direct = [];
        if (currentFilter.type === 'vault') direct = folders.filter(f => f.vault === currentFilter.value && !f.parent_id);
        else if (currentFilter.type === 'folder') direct = folders.filter(f => f.parent_id === currentFilter.value);
        else if (currentFilter.type === 'root') direct = folders.filter(f => !f.parent_id && f.vault === activeVault);
        else direct = folders.filter(f => !f.parent_id);

        // If no tag filter active, show all direct subfolders as before
        const { tags, mode } = activeTagFilters;
        if (tags.length === 0) return direct;

        // Helper: get all descendant folder ids of a given folder
        const getDescendantIds = (folderId) => {
            const result = [];
            const queue = [folderId];
            while (queue.length) {
                const cur = queue.shift();
                const children = folders.filter(f => f.parent_id === cur);
                children.forEach(c => { result.push(c.id); queue.push(c.id); });
            }
            return result;
        };

        // Only show folders that have at least one matching bookmark in their subtree
        return direct.filter(folder => {
            const scopeIds = [folder.id, ...getDescendantIds(folder.id)];
            const subtreeBookmarks = bookmarks.filter(b => scopeIds.includes(b.folder_id));
            return subtreeBookmarks.some(b => {
                const bTags = b.tags || [];
                return mode === 'and'
                    ? tags.every(t => bTags.includes(t))
                    : tags.some(t => bTags.includes(t));
            });
        });
    }, [folders, currentFilter, activeVault, activeTagFilters, bookmarks]);

    const interleavedItems = useMemo(() => {
        const items = [...filteredFolders, ...filteredBookmarks];
        console.log("interleavedItems before sort:", items.map(i => ({ id: i.id, name: i.name || i.title, position: i.position })));

        return items.sort((a, b) => (a.position ?? 999999) - (b.position ?? 999999));
    }, [filteredFolders, filteredBookmarks]);


    const visibleItems = useMemo(() => {
        return viewMode === 'list'
            ? interleavedItems
            : [...filteredFolders, ...filteredBookmarks];
    }, [viewMode, interleavedItems, filteredFolders, filteredBookmarks]);

    const getHeaderTitle = () => {
        if (currentFilter.type === 'archived') return 'Archived';
        if (currentFilter.type === 'screenshot') return 'With Screenshot';
        if (currentFilter.type === 'vault') return `Vault: ${currentFilter.value}`;
        // if (currentFilter.type === 'tag') return `Tag: #${currentFilter.value}`;
        if (currentFilter.type === 'folder') return `Folder View`;
        return 'All Bookmarks';
    };

    const breadcrumbs = useMemo(() => {
        if (currentFilter.type !== 'folder') return [];
        const path = [];
        let currentId = currentFilter.value;

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
            setFilter('root');
        }
    };

    const handleSelectAll = () => {
        const visibleBIds = filteredBookmarks.map(b => b.id);
        const visibleFIds = filteredFolders.map(f => f.id);

        const allBookmarksSelected = visibleBIds.every(id => selectedBookmarks.has(id));
        const allFoldersSelected = visibleFIds.every(id => selectedFolders.has(id));
        const isAllSelected = (visibleBIds.length > 0 || visibleFIds.length > 0) && allBookmarksSelected && allFoldersSelected;

        if (isAllSelected) {
            clearSelection();
        } else {
            setSelection(visibleBIds, visibleFIds);
        }
    };

    const allSelected = (filteredBookmarks.length > 0 || filteredFolders.length > 0) &&
        filteredBookmarks.every(b => selectedBookmarks.has(b.id)) &&
        filteredFolders.every(f => selectedFolders.has(f.id));
    if (currentVaultLocked) return (
        <main className="main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 48 }}>🔒</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Vault Locked</div>
            <div style={{ color: 'var(--text3)' }}>Enter your PIN to access this vault</div>
            <button className="btn btn-primary" onClick={() => setUnlockTarget(currentFilter.value)}>
                Unlock Vault
            </button>
        </main>
    );
    return (
        <SelectionContext.Provider value={{ onItemClick: handleItemClick }}>

            <main className="main"
                onContextMenu={handleBackgroundContextMenu}
                style={{ minHeight: '100%', paddingBottom: '100px' }}
            >
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
                    <button className="select-all-btn" onClick={handleSelectAll}>
                        {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                </div>

                <div id="bookmarksContainer" style={{ position: 'relative' }}>
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
                                    {filteredFolders.map(folder => <FolderCard key={`folder-${folder.id}`} folder={folder} />)}
                                    {filteredBookmarks.map(bm => <BookmarkCard key={bm.id} bm={bm} />)}
                                </>
                            ) : (
                                <SortableContext items={interleavedItems.map(item => item.id)} strategy={verticalListSortingStrategy}>
                                    {interleavedItems.map(item => (
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
        </SelectionContext.Provider>

    );
}