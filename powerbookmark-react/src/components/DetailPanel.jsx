import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { API_URL, api } from '../api';

export default function DetailPanel() {
  const { 
    detailBookmark: bm, setDetailBookmark, 
    isEditingDetails, setEditingDetails, saveBookmarkEdits,
    setArchiveViewBookmark, setTargetFetchIds, setBulkFetchOpen,
    setFilter // Successfully imported!
  } = useStore();

  // Local state for our inline inputs
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");

  // When we enter edit mode, pre-fill the inputs with the bookmark's current data
  useEffect(() => {
    if (bm && isEditingDetails) {
      setEditTitle(bm.title || "");
      setEditUrl(bm.url || "");
      setEditNotes(bm.notes || "");
      setEditTags((bm.tags || []).join(", "));
    }
  }, [bm, isEditingDetails]);

  if (!bm) return null;

  console.log("DetailPanel bm:", bm);


  const closePanel = () => {
    setDetailBookmark(null);
    setEditingDetails(false); // Reset edit state when closing
  };

  const handleSave = () => {
    // Convert comma string back to array
    const parsedTags = editTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    
    saveBookmarkEdits(bm.id, {
      title: editTitle,
      url: editUrl,
      notes: editNotes,
      tags: parsedTags
    });
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this bookmark?")) return;
    try {
      await api.bulkDeleteItems([bm.id], []);
      useStore.setState(state => ({
        bookmarks: state.bookmarks.filter(b => b.id !== bm.id),
        detailBookmark: null,
        isEditingDetails: false
      }));
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  };

  return (
    <div className="detail-overlay open">
      <div className="detail-backdrop" onClick={closePanel}></div>
      
      <div className="detail-panel">
        <div className="detail-header" style={{ alignItems: 'flex-start' }}>
          <button className="detail-close" onClick={closePanel}>✕</button>
          <div style={{ flex: 1 }}>
            {/* INLINE EDIT: TITLE */}
            {isEditingDetails ? (
              <input 
                className="tag-input" 
                style={{ fontSize: '18px', fontWeight: 600, padding: '4px 8px', width: '100%' }}
                value={editTitle} 
                onChange={e => setEditTitle(e.target.value)} 
                placeholder="Bookmark Title"
              />
            ) : (
              <div className="detail-title">{bm.title || bm.url}</div>
            )}
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-thumb">
            {bm.screenshot ? (
<img src={`${API_URL}/static/archive/${bm.screenshot_path.split('/').pop()}`} alt="" onError={(e) => e.target.style.display='none'} />
            ) : (
              <div className="detail-thumb-placeholder">🔖</div>
            )}
          </div>
          
          {/* INLINE EDIT: URL */}
          {isEditingDetails ? (
             <div className="detail-field" style={{ marginTop: '14px' }}>
               <div className="detail-field-label">URL</div>
               <input 
                 className="tag-input" 
                 value={editUrl} 
                 onChange={e => setEditUrl(e.target.value)} 
               />
             </div>
          ) : (
            <div className="detail-url" style={{ display: 'flex', alignItems: 'center', marginTop: '14px' }} onClick={() => window.open(bm.url, '_blank')}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--blue)' }}>
                {bm.url}
              </span>
            </div>
          )}

          {/* VAULT (Perfectly implemented by you) */}
          <div className="detail-field" style={{ marginTop: '14px' }}>
            <div className="detail-field-label">Vault</div>
            <div 
                className="detail-field-value" 
                style={{ opacity: 0.7, cursor: 'pointer', display: 'inline-block' }}
                onClick={() => { setFilter('vault', bm.vault || "default"); closePanel(); }}
            >
                📁 {bm.vault || "default"} <span style={{fontSize: 10}}>(Move to change)</span>
            </div>
          </div>

          {/* INLINE EDIT: TAGS (This is the missing update) */}
          <div className="detail-field">
            <div className="detail-field-label">Tags</div>
            {isEditingDetails ? (
              <input 
                className="tag-input" 
                value={editTags} 
                onChange={e => setEditTags(e.target.value)} 
                placeholder="tech, reading, code..."
              />
            ) : (
              <div className="detail-tags">
                {(bm.tags || []).length > 0 ? (
                  bm.tags.map(t => (
                    <span 
                      key={t} 
                      className="badge badge-tag" 
                      style={{ cursor: 'pointer' }}
                      onClick={() => { setFilter('tag', t); closePanel(); }}
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span style={{ color: 'var(--text3)', fontSize: '12px' }}>No tags</span>
                )}
              </div>
            )}
          </div>

          <div className="detail-field">
            <div className="detail-field-label">Saved</div>
            <div className="detail-field-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
              {bm.created_at ? new Date(bm.created_at).toLocaleString() : "—"}
            </div>
          </div>

          {/* INLINE EDIT: NOTES */}
          <div className="detail-field">
            <div className="detail-field-label">Notes</div>
            {isEditingDetails ? (
              <textarea 
                className="tag-input" 
                style={{ minHeight: '80px', resize: 'vertical' }}
                value={editNotes} 
                onChange={e => setEditNotes(e.target.value)} 
                placeholder="Add some notes..."
              />
            ) : (
              bm.notes ? <div className="detail-notes">{bm.notes}</div> : <span style={{ color: 'var(--text3)', fontSize: '12px' }}>—</span>
            )}
          </div>
        </div>

        {/* FOOTER ACTIONS SWAP BASED ON EDIT MODE */}
        <div className="detail-footer">
          {isEditingDetails ? (
            <>
              <button className="btn btn-secondary" onClick={() => setEditingDetails(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Save Changes</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => setEditingDetails(true)}>✏️ Edit</button>
              {bm.archived && <button className="btn btn-secondary" onClick={() => setArchiveViewBookmark(bm)}>📄 Archive</button>}
              <button className="btn btn-secondary" style={{ flex: '0 1 auto' }} onClick={() => { setTargetFetchIds([bm.id]); setBulkFetchOpen(true); }}>⚡</button>
              <button className="btn btn-danger-outline" style={{ flex: '0 1 auto' }} onClick={handleDelete}>🗑</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}