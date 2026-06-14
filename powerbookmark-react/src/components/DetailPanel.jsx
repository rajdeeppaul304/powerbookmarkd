// src/components/DetailPanel.jsx
import { useStore } from '../store';
import { hostOf, formatDate } from '../utils';
import { API_URL } from '../api';

export default function DetailPanel() {
  const { detailBookmark: bm, setDetailBookmark, setArchiveViewBookmark } = useStore();

  if (!bm) return null; // If no bookmark is selected, render absolutely nothing!

  const closePanel = () => setDetailBookmark(null);

  return (
    <div className="detail-overlay open">
      {/* Backdrop clicks close the panel */}
      <div className="detail-backdrop" onClick={closePanel}></div>
      
      <div className="detail-panel">
        <div className="detail-header">
          <button className="detail-close" onClick={closePanel}>✕</button>
          <div style={{ flex: 1 }}>
            <div className="detail-title">{bm.title || bm.url}</div>
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-thumb">
            {bm.screenshot ? (
              <img src={`${API_URL}/static/archive/${bm.id}.jpeg`} alt="" onError={(e) => e.target.style.display='none'} />
            ) : (
              <div className="detail-thumb-placeholder">🔖</div>
            )}
          </div>
          
          <div className="detail-title">{bm.title || "Untitled"}</div>
          
          <div className="detail-url" style={{ display: 'flex', alignItems: 'center' }} onClick={() => window.open(bm.url, '_blank')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--blue)' }}>
              {bm.url}
            </span>
          </div>

          <div className="detail-field" style={{ marginTop: '14px' }}>
            <div className="detail-field-label">Vault</div>
            <div className="detail-field-value">📁 {bm.vault || "default"}</div>
          </div>

          <div className="detail-field">
            <div className="detail-field-label">
              Tags <button style={{marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer'}}>Edit</button>
            </div>
            <div className="detail-tags">
              {(bm.tags || []).length > 0 ? (
                bm.tags.map(t => <span key={t} className="badge badge-tag">{t}</span>)
              ) : (
                <span style={{ color: 'var(--text3)', fontSize: '12px' }}>No tags</span>
              )}
            </div>
          </div>

          <div className="detail-field">
            <div className="detail-field-label">Saved</div>
            <div className="detail-field-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
              {bm.created_at ? new Date(bm.created_at).toLocaleString() : "—"}
            </div>
          </div>

          {bm.notes && (
            <div className="detail-field">
              <div className="detail-field-label">Notes</div>
              <div className="detail-notes">{bm.notes}</div>
            </div>
          )}
        </div>

        <div className="detail-footer">
          <button className="btn btn-primary" onClick={() => window.open(bm.url, '_blank')}>↗ Open</button>
          {bm.archived && (
            <button className="btn btn-secondary" onClick={() => setArchiveViewBookmark(bm)}>
              📄 Archive
            </button>
          )}
          <button className="btn btn-secondary" style={{ flex: '0 1 auto' }} title="Fetch screenshot & archive">⚡ Fetch</button>
          <button className="btn btn-danger-outline" style={{ flex: '0 1 auto' }}>🗑</button>
        </div>
      </div>
    </div>
  );
}