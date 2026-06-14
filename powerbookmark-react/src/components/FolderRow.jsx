// src/components/FolderRow.jsx
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';
import { api } from '../api';

export default function FolderRow({ folder }) {
  const { selectedFolders, toggleFolderSelection, setFilter, renameFolder, setContextMenu } = useStore();
  const isSelected = selectedFolders.has(folder.id);

  const { setNodeRef: setSortRef, setActivatorNodeRef, listeners: sortListeners, attributes: sortAttrs, transform, transition, isDragging: isSorting } = useSortable({
    id: folder.id,
    data: { type: 'folder-sortable', id: folder.id }
  });

  const { setNodeRef: setDragRef, listeners: dragListeners, attributes: dragAttrs, isDragging: isMoving } = useDraggable({
    id: `drag-folder-${folder.id}`,
    data: { type: 'folder', id: folder.id }
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-bucket-${folder.id}`,
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
    backgroundColor: isOver ? 'rgba(59,130,246,0.1)' : (isSelected ? 'rgba(59,130,246,0.05)' : ''),
  };

  const menuOptions = [
    {
      label: '📁 Open',
      action: () => setFilter('folder', folder.id)
    },
    {
      label: '✏️ Rename',
      action: () => renameFolder(folder.id, folder.name)
    },
    { separator: true },
    {
      label: '🗑 Delete',
      danger: true,
      action: async () => {
        if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
        try {
          await api.bulkDeleteItems([], [folder.id]);
          useStore.setState(state => ({
            folders: state.folders.filter(f => f.id !== folder.id)
          }));
        } catch (err) {
          alert('Failed to delete: ' + err.message);
        }
      }
    }
  ];

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, options: menuOptions });
  };

  const handleMenuButton = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, options: menuOptions });
  };

  return (
    <div
      ref={setSortRef}
      style={style}
      className="bookmark-row"
      onClick={() => toggleFolderSelection(folder.id)}
      onDoubleClick={() => setFilter('folder', folder.id)}
      onContextMenu={handleContextMenu}
    >
      {/* GRIP */}
      <div ref={setActivatorNodeRef} {...sortListeners} {...sortAttrs} className="reorder-handle" title="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="14" height="18" viewBox="0 0 10 14" fill="currentColor" style={{ outline: 'none' }}>
          <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
          <circle cx="3" cy="7"   r="1.2"/><circle cx="7" cy="7"   r="1.2"/>
          <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
        </svg>
      </div>

      {/* BODY + BUCKET */}
      <div
        ref={(node) => { setDragRef(node); setDropRef(node); }}
        {...dragListeners}
        {...dragAttrs}
        style={{ display: 'flex', flex: 1, alignItems: 'center', alignSelf: 'stretch', cursor: 'pointer', minWidth: 0 }}
      >
        <div style={{ padding: '0 8px 0 16px', fontSize: '20px' }}>📁</div>

        <div className="row-info">
          <div className="row-title" style={{ fontWeight: 600 }}>{folder.name}</div>
          <div className="row-url">Folder</div>
        </div>

        <div className="row-badges">
          <span className="badge badge-vault">{folder.vault || 'default'}</span>
        </div>

        <button className="action-btn" onClick={handleMenuButton}>
          ⋮
        </button>
      </div>
    </div>
  );
}