// src/App.jsx
import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
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
export default function App() {
  const { loadInitialData, isLoading, error, selectedBookmarks, moveBookmarksToFolder } = useStore();
  const [activeDragId, setActiveDragId] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

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
      <div className="app">
        <Topbar />
        <Sidebar />

        {isLoading ? (
          <main className="main"><div className="empty-state">Loading your library...</div></main>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/importer" element={<Importer />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        )}
      </div>

      {/* Mount the modals here globally */}
      <MassTaggerModal />
      <MassCopyModal />
      <MassMoveModal />
      <ArchiveViewer /> {/* <--- ADD THIS HERE */}
      <DragOverlay modifiers={[snapCenterToCursor]}>
        {activeDragId ? (() => {
          const { selectedBookmarks, selectedFolders } = useStore.getState();
          const totalSelected = selectedBookmarks.size + selectedFolders.size;
          
          const isDraggingSelection = 
            selectedBookmarks.has(activeDragId) || 
            selectedFolders.has(activeDragId.replace('drag-folder-', ''));
            
          const dragCount = (isDraggingSelection && totalSelected > 0) ? totalSelected : 1;

          return (
            <div style={{
              background: 'var(--bg3)', border: '1px solid var(--blue)', 
              padding: '4px 8px', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              color: 'var(--text)', fontSize: 12, fontWeight: 500, pointerEvents: 'none',
              width: '120px', textAlign: 'center'
            }}>
              {dragCount > 1 ? `Moving ${dragCount} items` : `Moving 1 item`}
            </div>
          );
        })() : null}
      </DragOverlay>
    </DndContext>
  );
}