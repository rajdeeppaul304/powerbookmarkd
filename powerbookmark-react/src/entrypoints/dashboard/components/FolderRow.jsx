// src/components/FolderRow.jsx
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';
import { api } from '../api';
import { SelectionContext } from './MainArea';
import { useContext } from 'react';

export default function FolderRow({ folder }) {
const { selectedFolders, setFilter, renameFolder, setContextMenu, setSelection, selectedBookmarks, requestDeletion, setClipboard } = useStore();
  const isSelected = selectedFolders.has(folder.id);
const { onItemClick } = useContext(SelectionContext);

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

  const isInMultiSelect = selectedFolders.has(folder.id) &&
  (selectedBookmarks.size + selectedFolders.size) > 1;

const menuOptions = isInMultiSelect ? [
  {
    label: '⧉ Copy',
    action: () => {
      const state = useStore.getState();
      setClipboard('copy', {
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    }
  },
  {
    label: '✂️ Cut',
    action: () => {
      const state = useStore.getState();
      setClipboard('cut', {
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    }
  },
  { separator: true },
  {
    label: '🗑 Delete',
    danger: true,
    action: () => {
      const state = useStore.getState();
      requestDeletion({
        bookmarkIds: Array.from(state.selectedBookmarks),
        folderIds: Array.from(state.selectedFolders)
      });
    }
  }
] : [
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
    
    // y: rect.top aligns the top edges.
    // x: rect.right - 180 pulls the menu left so its right edge aligns with the button.
    // (You can tweak the '180' up or down depending on how wide your menu actually is).
    setContextMenu({ 
        x: rect.right - 165, 
        y: rect.top, 
        options: menuOptions 
    });
  };

  return (
    <div
      ref={setSortRef}
      style={style}
      className="bookmark-row"
onClick={(e) => onItemClick(folder.id, e)}
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