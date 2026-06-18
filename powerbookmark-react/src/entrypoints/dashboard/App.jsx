// src/App.jsx
import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useStore } from './store';

// 1. Import DND stuff here now
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers'; // 2. Our cursor snapping magic

import Topbar from './components/Topbar';
import Sidebar from './components/Sidebar';

import Dashboard from './pages/Dashboard';
import Importer from './pages/Importer';
import Settings from './pages/Settings';

// Import the new Mass Action Modals
import MassTaggerModal from './components/MassTaggerModal';
import MassCopyModal from './components/MassCopyModal';
import MassMoveModal from './components/MassMoveModal';
import ArchiveViewer from './components/ArchiveViewer';
import JobWidget from './components/JobWidget';
import ContextMenu from './components/ContextMenu';
import UnlockModal from './components/UnlockModal';

import DeleteConfirmationModal from './components/DeleteConfirmationModal';
import Trash from './pages/Trash';

export default function App() {
  const { loadInitialData, isLoading, error, contextMenu, setContextMenu, clearSelection } = useStore();


  const [activeDragId, setActiveDragId] = useState(null);

  const location = useLocation();
  const showSidebar = location.pathname === '/';

  useEffect(() => {
    // 1. Initial boot-up (shows the loading screen)
    loadInitialData();
    useStore.getState().connectWebSocket();

    return () => {
      const ws = useStore.getState().ws;
      if (ws) ws.close();
    };
  }, [loadInitialData]);

  // CHANGE 2: Add this useEffect after the existing ones
  useEffect(() => {
    const handleMouseDown = (e) => {
      // Close context menu if clicking outside it
      if (contextMenu && !e.target.closest('.ctx-menu')) {
        setContextMenu(null);
      }
      // Deselect if clicking on empty space
      if (!e.target.closest(
        '.bookmark-row, .bookmark-card, .folder-card, .ctx-menu, .bulk-bar, .detail-panel'
      )) {
        clearSelection();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [clearSelection, contextMenu, setContextMenu]);  // <-- add contextMenu + setContextMenu to deps



  // --- DND HANDLERS ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event) => setActiveDragId(event.active.id);

  const handleDragEnd = (event) => {
    setActiveDragId(null);
    const { active, over } = event;

    if (!over) return;
    const activeType = active.data.current?.type || '';
    const overType = over.data.current?.type || '';

    // --- REORDER LOGIC (List View) ---
    if (activeType.includes('-sortable') && overType.includes('-sortable')) {
      if (active.id !== over.id) {
        useStore.getState().reorderItems(active.id, over.id);
      }
      return;
    }

    // --- UNIVERSAL MOVE TO FOLDER LOGIC ---
    if (overType === 'folder' || overType === 'folder-sortable') {
      const targetFolderId = over.data.current.id;
      const activeId = active.data.current.id;
      const { selectedBookmarks, selectedFolders, moveItemsToFolder } = useStore.getState();

      let bIdsToMove = [];
      let fIdsToMove = [];

      const isSelectedBookmark = activeType.startsWith('bookmark') && selectedBookmarks.has(activeId);
      const isSelectedFolder = activeType === 'folder' && selectedFolders.has(activeId);

      if (isSelectedBookmark || isSelectedFolder) {
        bIdsToMove = Array.from(selectedBookmarks);
        fIdsToMove = Array.from(selectedFolders);
      } else {
        if (activeType.startsWith('bookmark')) bIdsToMove = [activeId];
        if (activeType === 'folder') fIdsToMove = [activeId];
      }

      if (fIdsToMove.includes(targetFolderId)) {
        console.warn("Cannot move a folder into itself!");
        return;
      }

      moveItemsToFolder(bIdsToMove, fIdsToMove, targetFolderId);
    }
  };

  // --- ERROR STATE ---
  if (error) {
    return (
      <div className="empty-state" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="empty-icon">⚠️</div>
        <div className="empty-title">Can't reach powerbookmarkd</div>
        <div className="empty-sub">{error}</div>
      </div>
    );
  }

  // --- MAIN RENDER ---
  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

      {/* Force the app into a vertical flex column */}
      <div className="app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Topbar />

        {/* Force the body into a horizontal flex row */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Sidebar takes its natural width if it exists */}
          {showSidebar && <Sidebar />}

          {/* Main wrapper takes the REST of the space (flex: 1). 
              If Sidebar is gone, it takes 100%! */}
          <div className={showSidebar ? "main-wrapper" : "main-wrapper-full"} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            {isLoading ? (
              <main className="main"><div className="empty-state">Loading your library...</div></main>
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/importer" element={<Importer />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/trash" element={<Trash />} />

              </Routes>
            )}
          </div>

        </div>
      </div>

      {/* Mount the modals here globally */}
      <MassTaggerModal />
      <MassCopyModal />
      <MassMoveModal />
      <ArchiveViewer />
      <DeleteConfirmationModal />
      <JobWidget />
      <UnlockModal />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenu.options}
          onClose={() => setContextMenu(null)}
        />
      )}

      <DragOverlay modifiers={[snapCenterToCursor]}>
    {activeDragId ? (() => {
        const { selectedBookmarks, selectedFolders } = useStore.getState();
        const totalSelected = selectedBookmarks.size + selectedFolders.size;

        // Strip all known prefixes to get the bare ID
        const bareId = activeDragId
            .replace('drag-folder-', '')
            .replace('drag-bm-', '')
            .replace('bookmark-', '');

        const isDraggingSelection =
            selectedBookmarks.has(bareId) ||
            selectedFolders.has(bareId);

        const dragCount = (isDraggingSelection && totalSelected > 0) ? totalSelected : 1;

        // Get the name of the single item being dragged (for the pill label)
        const { bookmarks, folders } = useStore.getState();
        const draggedBookmark = bookmarks.find(b => b.id === bareId);
        const draggedFolder = folders.find(f => f.id === bareId);
        const singleLabel = draggedBookmark
            ? (draggedBookmark.title || draggedBookmark.url)
            : draggedFolder
                ? draggedFolder.name
                : 'Item';

        return (
            <div style={{
                background: 'var(--bg3)',
                border: '1px solid var(--blue)',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                color: 'var(--text)',
                fontSize: 12,
                fontWeight: 500,
                pointerEvents: 'none',
                maxWidth: 220,
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                position: 'relative',
            }}>
                {dragCount > 1 && (
                    <div style={{
                        position: 'absolute',
                        top: -8, right: -8,
                        background: 'var(--blue)',
                        color: '#fff',
                        borderRadius: '50%',
                        width: 20, height: 20,
                        fontSize: 11, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {dragCount}
                    </div>
                )}
                <span style={{ fontSize: 16 }}>
                    {draggedFolder ? '📁' : '🔖'}
                </span>
                <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {singleLabel}

                </span>
            </div>
        );
    })() : null}
</DragOverlay>
    </DndContext>
  );
}