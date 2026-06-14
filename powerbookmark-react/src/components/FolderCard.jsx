// src/components/FolderCard.jsx
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useStore } from '../store';
import { api } from '../api';

export default function FolderCard({ folder }) {
  const { selectedFolders, toggleFolderSelection, setFilter, renameFolder, setContextMenu } = useStore();
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
      ref={setBothRefs}
      {...listeners}
      {...attributes}
      className="bookmark-card folder-card"
      onClick={() => toggleFolderSelection(folder.id)}
      onDoubleClick={() => setFilter('folder', folder.id)}
      onContextMenu={handleContextMenu}
      style={{
        opacity: isDragging ? 0.4 : 1,
        outline: isSelected ? '2px solid var(--blue)' : 'none',
        outlineOffset: '-2px',
        backgroundColor: isOver ? 'rgba(59,130,246,0.1)' : (isSelected ? 'rgba(59,130,246,0.05)' : 'var(--bg2)'),
        height: '80px',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        cursor: 'pointer', position: 'relative',
      }}
    >
      <div style={{ fontSize: '32px', marginRight: '16px' }}>📁</div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {folder.name}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text3)' }}>Folder</div>
      </div>

      <button
        className="card-action-btn"
        onClick={handleMenuButton}
        style={{
          position: 'absolute', top: 8, right: 8,
          width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, lineHeight: 1,
          borderRadius: 6, border: 'none',
          background: 'var(--bg3)', color: 'var(--text)',
          cursor: 'pointer', opacity: 0.7,
        }}
      >
        ⋮
      </button>
    </div>
  );
}