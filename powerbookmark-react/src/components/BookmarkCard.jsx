// src/components/BookmarkCard.jsx
import { useDraggable } from '@dnd-kit/core';
import { useStore } from '../store';
import { hostOf } from '../utils';
import { API_URL } from '../api';

export default function BookmarkCard({ bm }) {
const { selectedBookmarks, toggleBookmarkSelection, setDetailBookmark, setArchiveViewBookmark, setFilter } = useStore();
  const isSelected = selectedBookmarks.has(bm.id);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bookmark-${bm.id}`,
    data: { type: 'bookmark', id: bm.id }
  });

  // SINGLE CLICK: Select
  const handleSingleClick = (e) => {
    if (e.target.closest('.card-action-btn')) return;
    toggleBookmarkSelection(bm.id);
  };

  // DOUBLE CLICK: Open Details
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
      style={{ 
        opacity: isDragging ? 0.4 : 1,
        // Replace the background color selection with a crisp blue outline
        outline: isSelected ? '2px solid var(--blue)' : 'none',
        outlineOffset: '-2px', // Keeps the outline inside so it doesn't shift the layout
        backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : 'var(--bg2)',
        cursor: 'pointer' // Shows the user it's interactive
      }} 
    >
      {/* ❌ REMOVED THE CHECKBOX DIV */}
      
      <div className="card-thumb">
        {bm.screenshot ? <img src={`${API_URL}/static/archive/${bm.id}.jpeg`} alt="" onError={(e) => e.target.style.display='none'} /> : <div className="card-thumb-placeholder">🔖</div>}
      </div>

      <div className="card-info">
        <div className="card-title">{bm.title || bm.url}</div>
        <div className="card-url" style={{ display: 'flex', alignItems: 'center' }}>
          {bm.favicon_path ? <img src={`${API_URL}/static/favicons/${bm.id}.ico`} style={{width: 14, height: 14, marginRight: 6, borderRadius: 2}} onError={(e) => e.target.style.display='none'} /> : <span style={{fontSize: 12, marginRight: 6, opacity: 0.7}}>🌐</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostOf(bm.url)}</span>
        </div>
      </div>

      <div className="card-badges">
        <span 
            className="badge badge-vault" 
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); setFilter('vault', bm.vault || "default"); }}
        >
            {bm.vault || "default"}
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
        
        {bm.archived && <span className="badge" style={{background: 'rgba(59,130,246,0.1)', color: 'var(--blue)'}}>📦</span>}
      </div>

      <button 
        className="card-action-btn" 
        onClick={(e) => { e.stopPropagation(); setDetailBookmark(bm, true); }} // true = Start Editing!
        style={{ position: 'absolute', top: '8px', right: bm.archived ? '60px' : '8px', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', border: 'none', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', opacity: 0.8 }}
      >
        ✏️
      </button>

      {bm.archived && (
        <button 
          className="card-action-btn" 
          onClick={(e) => { e.stopPropagation(); setArchiveViewBookmark(bm); }}
          style={{ 
            position: 'absolute', top: '8px', right: '8px', 
            padding: '4px 8px', fontSize: '11px', borderRadius: '4px', 
            border: 'none', background: 'var(--blue)', color: '#fff', 
            cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' 
          }}
        >
          📄 View
        </button>
      )}
    </div>
  );
}