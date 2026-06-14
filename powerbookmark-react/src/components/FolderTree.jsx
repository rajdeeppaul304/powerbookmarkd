import { useState } from 'react';
import { useStore } from '../store';
import { useDroppable, useDraggable } from '@dnd-kit/core';
// This component recursively calls itself!
// Modify your FolderTree function to look like this:
export default function FolderTree({ parentId = null, depth = 0 }) {
      const { folders, activeVault } = useStore(); // <--- Pull activeVault directly
  
  const childFolders = folders
    .filter(f => (f.parent_id || null) === parentId)
    .filter(f => depth > 0 || f.vault === activeVault) // <--- Use it here safely
    .sort((a, b) => (a.position ?? 999999) - (b.position ?? 999999));
  
  if (childFolders.length === 0 && depth > 0) return null;

  return (
    <>
      {depth === 0 && <RootDropRow />}
      {childFolders.map(f => (
        <FolderRow key={f.id} folder={f} depth={depth} />
      ))}
    </>
  );
}

// Persistent target for the top level of the sidebar
function RootDropRow() {
    const { setFilter, currentFilter } = useStore();

    const { setNodeRef, isOver } = useDroppable({
        id: `drop-sidebar-root`,
        data: { type: 'folder', id: null } // id: null tells the backend "remove the parent_id"
    });

const isActive = currentFilter.type === 'root'; // <--- FIX HERE
    return (
        <div
      ref={setNodeRef}
      className={`folder-tree-row ${isActive ? 'active' : ''} ${isOver ? 'drag-over' : ''}`}
      style={{ paddingLeft: '10px', backgroundColor: isOver ? 'rgba(59,130,246,0.18)' : '', color: isOver ? 'var(--blue)' : '', cursor: 'pointer' }}
      onClick={() => setFilter('root')} // <--- FIX HERE
    >
            <span className="folder-chevron-spacer"></span>
            <span className="item-icon">🗂</span>
            <span className="item-name" style={{ fontWeight: 600 }}>Root</span>
        </div>
    );
}


// Sub-component so each row manages its own open/close state
function FolderRow({ folder, depth }) {
    const { folders, currentFilter, setFilter, bookmarks } = useStore();
    const [isExpanded, setIsExpanded] = useState(true);

    // 1. MAKE IT DROPPABLE (It can catch things)
    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `drop-sidebar-${folder.id}`,
        data: { type: 'folder', id: folder.id }
    });


    // 2. MAKE IT DRAGGABLE (It can be moved)
    const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
        id: `drag-sidebar-${folder.id}`,
        data: { type: 'folder', id: folder.id }
    });

    // --- DND-KIT SETUP ---
    // const { setNodeRef, isOver } = useDroppable({
    //     id: `folder-${folder.id}`,
    //     data: { type: 'folder', id: folder.id }
    // });

    const hasChildren = folders.some(f => f.parent_id === folder.id);
    const isActive = currentFilter.type === 'folder' && currentFilter.value === folder.id;

    // Count bookmarks directly inside this folder
    const count = bookmarks.filter(b => b.folder_id === folder.id).length;

    const handleToggle = (e) => {
        e.stopPropagation(); // Stop the click from selecting the folder
        setIsExpanded(!isExpanded);
    };

    return (
        <>
            <div
                ref={(node) => { setDragRef(node); setDropRef(node); }} // Combine the refs!
                {...listeners}
                {...attributes}
                className={`folder-tree-row ${isActive ? 'active' : ''} ${isOver ? 'drag-over' : ''}`}
                style={{
                    paddingLeft: `${10 + (depth * 14)}px`,
                    backgroundColor: isOver ? 'rgba(59,130,246,0.18)' : '',
                    color: isOver ? 'var(--blue)' : '',
                    opacity: isDragging ? 0.4 : 1, // Fade out while moving it
                    cursor: 'pointer'
                }}
                onClick={() => setFilter('folder', folder.id)}
            >
                {hasChildren ? (
                    <span
                        className={`folder-chevron ${isExpanded ? 'open' : ''}`}
                        onClick={handleToggle}
                    >▶</span>
                ) : (
                    <span className="folder-chevron-spacer"></span>
                )}
                <span className="item-icon">📁</span>
                <span className="item-name">{folder.name}</span>
                <span className="item-count">{count}</span>
            </div>

            {/* THE MAGIC: If expanded, it calls FolderTree again to render its children */}
            {hasChildren && isExpanded && (
                <FolderTree parentId={folder.id} depth={depth + 1} />
            )}
        </>
    );
}