// src/components/BookmarkRow.jsx
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';
import { hostOf } from '../utils';
import { API_URL, api } from '../api';

export default function BookmarkRow({ bm }) {
  const {
    selectedBookmarks, toggleBookmarkSelection, setDetailBookmark, selectedFolders,
    setArchiveViewBookmark, setFilter, setContextMenu,
    setTargetFetchIds, setBulkFetchOpen,
    requestDeletion, // <--- Add the new delete funnel
    setClipboard, setSelection  // <--- Add the clipboard setter
  } = useStore();

  const isSelected = selectedBookmarks.has(bm.id);

  const {
    setNodeRef: setSortRef, setActivatorNodeRef,
    listeners: sortListeners, attributes: sortAttrs,
    transform, transition, isDragging: isSorting
  } = useSortable({
    id: bm.id,
    data: { type: 'bookmark-sortable', id: bm.id }
  });

  const {
    setNodeRef: setDragRef, listeners: dragListeners, attributes: dragAttrs,
    isDragging: isMoving
  } = useDraggable({
    id: `drag-bm-${bm.id}`,
    data: { type: 'bookmark', id: bm.id }
  });

  const isDragging = isSorting || isMoving;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    position: isDragging ? 'relative' : 'static',
    zIndex: isDragging ? 99 : 'auto',
    outline: isSelected ? '2px solid var(--blue)' : 'none',
    outlineOffset: '-2px',
    backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : '',
  };


  const isInMultiSelect = selectedBookmarks.has(bm.id) &&
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
    ...(selectedFolders.size === 0 ? [{
      label: '⚡ Fetch Archive',
      action: () => {
        const state = useStore.getState();
        setTargetFetchIds(Array.from(state.selectedBookmarks));
        setBulkFetchOpen(true);
      }
    }] : []),
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
      label: '↗ Open Link',
      action: () => window.open(bm.url, '_blank')
    },
    {
      label: '✏️ Edit',
      action: () => setDetailBookmark(bm, true)
    },
    { separator: true },
    {
      label: '⧉ Copy',
      action: () => {
        // If the item is part of a multi-selection, copy the whole selection!
        // Otherwise, just copy this single item.
        if (selectedBookmarks.has(bm.id)) {
          const state = useStore.getState();
          setClipboard('copy', {
            bookmarkIds: Array.from(state.selectedBookmarks),
            folderIds: Array.from(state.selectedFolders)
          });
        } else {
          setClipboard('copy', { bookmarkIds: [bm.id], folderIds: [] });
        }
      }
    },
    {
      label: '✂️ Cut',
      action: () => {
        if (selectedBookmarks.has(bm.id)) {
          const state = useStore.getState();
          setClipboard('cut', {
            bookmarkIds: Array.from(state.selectedBookmarks),
            folderIds: Array.from(state.selectedFolders)
          });
        } else {
          setClipboard('cut', { bookmarkIds: [bm.id], folderIds: [] });
        }
      }
    },
    { separator: true },
    {
      label: '📄 Open Archive',
      disabled: !bm.archived,
      action: () => {
        if (!bm.archived) return;
        setArchiveViewBookmark(bm);
      }
    },
    {
      label: '⚡ Fetch Archive',
      action: () => {
        setTargetFetchIds([bm.id]);
        setBulkFetchOpen(true);
      }
    },
    { separator: true },
    {
      label: '🗑 Delete',
      danger: true,
      action: () => {
        // Use our shiny new single point of truth!
        if (selectedBookmarks.has(bm.id)) {
          const state = useStore.getState();
          requestDeletion({
            bookmarkIds: Array.from(state.selectedBookmarks),
            folderIds: Array.from(state.selectedFolders)
          });
        } else {
          requestDeletion({ bookmarkIds: [bm.id], folderIds: [] });
        }
      }
    }
  ];

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking something NOT in the current multi-selection, select it exclusively
    if (!selectedBookmarks.has(bm.id)) {
      setSelection([bm.id], []);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, options: menuOptions });
  };

  // Uses getBoundingClientRect instead of pointer coords — dnd-kit can't swallow it
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
      onClick={() => toggleBookmarkSelection(bm.id)}
      onDoubleClick={() => setDetailBookmark(bm)}
      onContextMenu={handleContextMenu}
    >
      {/* GRIP — reorder only */}
      <div
        ref={setActivatorNodeRef}
        {...sortListeners}
        {...sortAttrs}
        className="reorder-handle"
        title="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="14" height="18" viewBox="0 0 10 14" fill="currentColor" style={{ outline: 'none' }}>
          <circle cx="3" cy="2.5" r="1.2" /><circle cx="7" cy="2.5" r="1.2" />
          <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
          <circle cx="3" cy="11.5" r="1.2" /><circle cx="7" cy="11.5" r="1.2" />
        </svg>
      </div>

      {/* BODY — move drag target */}
      <div
        ref={setDragRef}
        {...dragListeners}
        {...dragAttrs}
        style={{ display: 'flex', flex: 1, alignItems: 'center', cursor: 'pointer', alignSelf: 'stretch', minWidth: 0 }}
      >
        <div className="row-thumb">
          {bm.screenshot
            ? <img src={`${API_URL}/static/archive/${bm.screenshot_path.split('/').pop()}`} alt="" onError={(e) => e.target.style.display = 'none'} />
            : <div className="row-thumb-placeholder">🔖</div>
          }
        </div>

        <div className="row-info">
          <div className="row-title">{bm.title || bm.url}</div>
          <div className="row-url" style={{ display: 'flex', alignItems: 'center' }}>
            {bm.favicon_path
              ? <img src={`${API_URL}/static/favicons/${bm.favicon_path.split('/').pop()}`} style={{ width: 14, height: 14, marginRight: 6, borderRadius: 2 }} onError={(e) => e.target.style.display = 'none'} />
              : <span style={{ fontSize: 12, marginRight: 6, opacity: 0.7 }}>🌐</span>
            }
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hostOf(bm.url)}
            </span>
          </div>
        </div>

        <div className="row-badges">
          <span
            className="badge badge-vault"
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); setFilter('vault', bm.vault || 'default'); }}
          >
            {bm.vault || 'default'}
          </span>

          {(bm.tags || []).slice(0, 2).map(t => (
            <span
              key={t}
              className="badge badge-tag"
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setFilter('tag', t); }}
            >
              {t}
            </span>
          ))}

          {bm.archived && (
            <span className="badge" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--blue)' }}>📦</span>
          )}
        </div>

        <button className="action-btn" onClick={handleMenuButton}>
          ⋮
        </button>
      </div>
    </div>
  );
}