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
import DeleteConfirmationModal from './components/DeleteConfirmationModal';

export default function App() {
const { loadInitialData, isLoading, error, selectedBookmarks, 
        moveBookmarksToFolder, contextMenu, setContextMenu } = useStore();
  const [activeDragId, setActiveDragId] = useState(null);

  const location = useLocation();
  const showSidebar = location.pathname === '/';

  useEffect(() => {
    // 1. Initial boot-up (shows the loading screen)
    loadInitialData();

    // 2. Start the silent walkie-talkie heartbeat
    const syncInterval = setInterval(() => {
      // ONLY sync if the user is actually looking at the tab!
      if (!document.hidden) {
        useStore.getState().silentSync();
      }
    }, 3000);

    // The Job Pager (Every 1s for smooth progress bars)
    const jobInterval = setInterval(() => {
      if (!document.hidden) useStore.getState().fetchJobsStatus();
    }, 1000);



    // 3. Clean up the timer if the app ever unmounts
    return () => {
        clearInterval(syncInterval);
        clearInterval(jobInterval);
    };
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

      {useStore.getState().contextMenu && (
        <ContextMenu 
          x={useStore.getState().contextMenu.x} 
          y={useStore.getState().contextMenu.y} 
          options={useStore.getState().contextMenu.options} 
          onClose={() => useStore.getState().setContextMenu(null)} 
        />
      )}
      
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