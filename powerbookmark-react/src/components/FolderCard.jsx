// src/components/FolderCard.jsx
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useStore } from '../store';

export default function FolderCard({ folder }) {
  const { selectedFolders, toggleFolderSelection, setFilter, renameFolder } = useStore();
  const isSelected = selectedFolders.has(folder.id);

  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: `drag-folder-${folder.id}`,
    data: { type: 'folder', id: folder.id }
  });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `drop-folder-${folder.id}`,
    data: { type: 'folder', id: folder.id }
  });

  const setBothRefs = (node) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  // SINGLE CLICK: Select
  const handleSingleClick = () => {
    toggleFolderSelection(folder.id);
  };

  // DOUBLE CLICK: Navigate inside
  const handleDoubleClick = () => {
    setFilter('folder', folder.id);
  };

  return (
    <div 
      ref={setBothRefs}
      {...listeners}
      {...attributes}
      className={`bookmark-card folder-card`}
      onClick={handleSingleClick}
      onDoubleClick={handleDoubleClick}
      style={{ 
        opacity: isDragging ? 0.4 : 1,
        outline: isSelected ? '2px solid var(--blue)' : 'none',
        outlineOffset: '-2px',
        backgroundColor: isOver ? 'rgba(59,130,246,0.1)' : (isSelected ? 'rgba(59,130,246,0.05)' : 'var(--bg2)'),
        height: '80px',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        cursor: 'pointer'
      }}
    >
      {/* ❌ REMOVED THE CHECKBOX DIV */}
      
      <div style={{ fontSize: '32px', marginRight: '16px' }}>📁</div>
      
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {folder.name}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Folder</div>
      </div>

      <button 
        className="card-action-btn" 
        onClick={(e) => { e.stopPropagation(); renameFolder(folder.id, folder.name); }}
        style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: 'none', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', opacity: 0.8 }}
      >
        ✏️
      </button>
    </div>
  );
}