// src/components/FolderCard.jsx
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useStore } from '../store';
import { api } from '../api';
import { SelectionContext } from './MainArea';
import { useContext } from 'react';

export default function FolderCard({ folder }) {
const { selectedFolders, setFilter, renameFolder, setContextMenu, setSelection } = useStore();
  const isSelected = selectedFolders.has(folder.id);
const { onItemClick } = useContext(SelectionContext);

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
  label: '⧉ Copy',
  action: () => {
    const state = useStore.getState();
    if (state.selectedFolders.has(folder.id)) {
      setClipboard('copy', {
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    } else {
      setClipboard('copy', { bookmarkIds: [], folderIds: [folder.id] });
    }
  }
},
{
  label: '✂️ Cut',
  action: () => {
    const state = useStore.getState();
    if (state.selectedFolders.has(folder.id)) {
      setClipboard('cut', {
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    } else {
      setClipboard('cut', { bookmarkIds: [], folderIds: [folder.id] });
    }
  }
},
{ separator: true },
    {
  label: '🗑 Delete',
  danger: true,
  action: () => {
    const state = useStore.getState();
    if (state.selectedFolders.has(folder.id)) {
      requestDeletion({
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    } else {
      requestDeletion({ bookmarkIds: [], folderIds: [folder.id] });
    }
  }
}
  ];
const handleContextMenu = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!selectedFolders.has(folder.id)) {
    setSelection([], [folder.id]);
  }
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
onClick={(e) => onItemClick(folder.id, e)}
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