// src/components/FolderRow.jsx
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';

export default function FolderRow({ folder }) {
  const { selectedFolders, toggleFolderSelection, setFilter, renameFolder} = useStore();
  const isSelected = selectedFolders.has(folder.id);

  // 1. REORDER ENGINE (Outer Wrapper & Grip)
  const { setNodeRef: setSortRef, setActivatorNodeRef, listeners: sortListeners, attributes: sortAttrs, transform, transition, isDragging: isSorting } = useSortable({
    id: folder.id,
    data: { type: 'folder-sortable', id: folder.id }
  });

  // 2. MOVE ENGINE (Inner Body)
  const { setNodeRef: setDragRef, listeners: dragListeners, attributes: dragAttrs, isDragging: isMoving } = useDraggable({
    id: `drag-folder-${folder.id}`,
    data: { type: 'folder', id: folder.id }
  });

  // 3. BUCKET ENGINE (Inner Body)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-bucket-${folder.id}`, // Unique ID prevents dnd-kit collision
    data: { type: 'folder', id: folder.id }
  });

  const isDragging = isSorting || isMoving;

const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: isDragging ? 'relative' : 'static',
    zIndex: isDragging ? 99 : 'auto',
    outline: isSelected ? '2px solid var(--blue)' : 'none',
    outlineOffset: '-2px',
    // 1. ADD THIS HERE:
    backgroundColor: isOver ? 'rgba(59,130,246,0.1)' : (isSelected ? 'rgba(59,130,246,0.05)' : '')
  };

  const handleSingleClick = () => toggleFolderSelection(folder.id);
  const handleDoubleClick = () => setFilter('folder', folder.id);

  return (
    <div ref={setSortRef} style={style} className={`bookmark-row`}>
      
      {/* THE GRIP */}
      <div ref={setActivatorNodeRef} {...sortListeners} {...sortAttrs} className="reorder-handle" title="Drag to reorder">
        <svg width="14" height="18" viewBox="0 0 10 14" fill="currentColor" style={{ outline: 'none' }}>
          <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
          <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
          <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
        </svg>
      </div>

      {/* THE BODY & BUCKET */}
      <div 
        ref={(node) => { setDragRef(node); setDropRef(node); }} 
        {...dragListeners} 
        {...dragAttrs} 
        style={{ 
          display: 'flex', flex: 1, alignItems: 'center', cursor: 'pointer',
          // 2. REMOVE the backgroundColor and transition lines from here!
        }}
        onClick={handleSingleClick} 
        onDoubleClick={handleDoubleClick}
      >
        <div style={{ padding: '0 8px 0 16px', fontSize: '20px' }}>📁</div>
        
        <div className="row-info">
          <div className="row-title" style={{ fontWeight: 600 }}>{folder.name}</div>
          <div className="row-url">Folder</div>
        </div>

        <div className="row-badges">
          <span className="badge badge-vault">{folder.vault || "default"}</span>
        </div>
        <div className="row-actions">
          <button className="action-btn" onClick={(e) => { e.stopPropagation(); renameFolder(folder.id, folder.name); }}>✏️ Rename</button>
        </div>
      </div>
    </div>
  );
}