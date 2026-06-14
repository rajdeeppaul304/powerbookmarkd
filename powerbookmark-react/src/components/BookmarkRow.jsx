// src/components/BookmarkRow.jsx
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core'; // <--- Import Draggable!
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';
import { hostOf } from '../utils';
import { API_URL } from '../api';

export default function BookmarkRow({ bm }) {
const { selectedBookmarks, toggleBookmarkSelection, setDetailBookmark, setArchiveViewBookmark , setFilter} = useStore();
  const isSelected = selectedBookmarks.has(bm.id);

  // 1. REORDER ENGINE (Attached only to the grip handle)
  const { 
    setNodeRef: setSortRef, setActivatorNodeRef, listeners: sortListeners, attributes: sortAttrs, 
    transform, transition, isDragging: isSorting 
  } = useSortable({
    id: bm.id, // Matches the SortableContext array
    data: { type: 'bookmark-sortable', id: bm.id }
  });

  // 2. MOVE ENGINE (Attached to the body of the row)
  const { 
    setNodeRef: setDragRef, listeners: dragListeners, attributes: dragAttrs, isDragging: isMoving 
  } = useDraggable({
    id: `drag-bm-${bm.id}`,
    data: { type: 'bookmark', id: bm.id }
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
    backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : ''
  };

  const handleSingleClick = () => toggleBookmarkSelection(bm.id);
  const handleDoubleClick = () => setDetailBookmark(bm);

  return (
    <div ref={setSortRef} style={style} className={`bookmark-row`}>
      
      {/* THE GRIP (Triggers Reorder) */}
      <div ref={setActivatorNodeRef} {...sortListeners} {...sortAttrs} className="reorder-handle" title="Drag to reorder">
        <svg width="14" height="18" viewBox="0 0 10 14" fill="currentColor" style={{ outline: 'none' }}>
          <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
          <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
          <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
        </svg>
      </div>

      {/* THE BODY (Triggers Move & Clicks) */}
      <div 
        ref={setDragRef} {...dragListeners} {...dragAttrs} 
        style={{ display: 'flex', flex: 1, alignItems: 'center', cursor: 'pointer' }}
        onClick={handleSingleClick} onDoubleClick={handleDoubleClick}
      >
        <div className="row-thumb">
          {bm.screenshot ? <img src={`${API_URL}/static/archive/${bm.id}.jpeg`} alt="" onError={(e) => e.target.style.display='none'} /> : <div className="row-thumb-placeholder">🔖</div>}
        </div>

        <div className="row-info">
          <div className="row-title">{bm.title || bm.url}</div>
          <div className="row-url" style={{ display: 'flex', alignItems: 'center' }}>
            {bm.favicon_path ? <img src={`${API_URL}/static/favicons/${bm.id}.ico`} style={{width: 14, height: 14, marginRight: 6, borderRadius: 2}} onError={(e) => e.target.style.display='none'} /> : <span style={{fontSize: 12, marginRight: 6, opacity: 0.7}}>🌐</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostOf(bm.url)}</span>
          </div>
        </div>

        <div className="row-badges">
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

        

        <div className="row-actions">
            <button className="action-btn" onClick={(e) => { e.stopPropagation(); setDetailBookmark(bm, true); }}>✏️ Edit</button>
          {bm.archived && (
            <button className="action-btn" onClick={(e) => { e.stopPropagation(); setArchiveViewBookmark(bm); }}>
              📄 Archive
            </button>
          )}
          <button className="action-btn" onClick={(e) => { e.stopPropagation(); window.open(bm.url, '_blank'); }}>↗ Open</button>
        </div>
      </div>
    </div>
  );
}