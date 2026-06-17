// src/components/BookmarkCard.jsx
import { useDraggable } from '@dnd-kit/core';
import { useStore } from '../store';
import { hostOf } from '../utils';
import { API_URL, api } from '../api';

export default function BookmarkCard({ bm }) {
  const {
    setContextMenu,
    selectedBookmarks,
    toggleBookmarkSelection,
    setDetailBookmark,
    setArchiveViewBookmark,
    setFilter,
    setTargetFetchIds,
    setBulkFetchOpen,
      setSelection,       // ADD
  requestDeletion,    // ADD
  setClipboard,       // ADD

  } = useStore();

  const isSelected = selectedBookmarks.has(bm.id);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bookmark-${bm.id}`,
    data: { type: 'bookmark', id: bm.id }
  });

  const menuOptions = [
    {
      label: '🔗 Open Link',
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
  if (!selectedBookmarks.has(bm.id)) {
    setSelection([bm.id], []);
  }
  setContextMenu({ x: e.clientX, y: e.clientY, options: menuOptions });
};

  // Same trick as BookmarkRow — uses rect coords, dnd-kit can't swallow it
  const handleMenuButton = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, options: menuOptions });
  };

  const handleSingleClick = (e) => {
    if (e.target.closest('.card-action-btn')) return;
    toggleBookmarkSelection(bm.id);
  };

  const handleDoubleClick = (e) => {
    if (e.target.closest('.card-action-btn')) return;
    setDetailBookmark(bm);
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`bookmark-card ${isDragging ? 'dragging' : ''}`}
      onClick={handleSingleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        opacity: isDragging ? 0.4 : 1,
        outline: isSelected ? '2px solid var(--blue)' : 'none',
        outlineOffset: '-2px',
        backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : 'var(--bg2)',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div className="card-thumb">
        {bm.screenshot
          ? <img src={`${API_URL}/static/archive/${bm.screenshot_path.split('/').pop()}`} alt="" onError={(e) => e.target.style.display = 'none'} />
          : <div className="card-thumb-placeholder">🔖</div>
        }
      </div>

      <div className="card-info">
        <div className="card-title">{bm.title || bm.url}</div>
        <div className="card-url" style={{ display: 'flex', alignItems: 'center' }}>
          {bm.favicon_path
            ? <img src={`${API_URL}/static/favicons/${bm.favicon_path.split('/').pop()}`} style={{ width: 14, height: 14, marginRight: 6, borderRadius: 2 }} onError={(e) => e.target.style.display = 'none'} />
            : <span style={{ fontSize: 12, marginRight: 6, opacity: 0.7 }}>🌐</span>
          }
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostOf(bm.url)}</span>
        </div>
      </div>

      <div className="card-badges">
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

      {/* ⋮ button — top right, same pattern as BookmarkRow */}
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