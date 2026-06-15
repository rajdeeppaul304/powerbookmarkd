// src/components/ArchiveViewer.jsx
import { useStore } from '../store';
import { API_URL } from '../api';

export default function ArchiveViewer() {
  const { archiveViewBookmark: bm, setArchiveViewBookmark } = useStore();

  if (!bm) return null;

  const archiveUrl = `${API_URL}/static/archive/${bm.html_path.split('/').pop()}`;


  return (
    <div className="modal-overlay open" onClick={() => setArchiveViewBookmark(null)} style={{ zIndex: 99999 }}>
      <div 
        className="modal-box" 
        style={{ 
          width: '95vw', maxWidth: '1400px', height: '95vh', maxHeight:'95vh',
          display: 'flex', flexDirection: 'column', padding: 0,
          overflow: 'hidden', background: '#fff' // Ensure background is white for HTML pages
        }} 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Viewer Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
            <span style={{ fontSize: '18px' }}>📄</span>
            <div style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Offline Archive: {bm.title || bm.url}
            </div>
          </div>
          <button className="btn " onClick={() => setArchiveViewBookmark(null)}>Close</button>
        </div>

        {/* The Actual Iframe */}
        <div style={{ flex: 1, position: 'relative' }}>
          <iframe
            src={archiveUrl}
            title={`Archive of ${bm.title}`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            sandbox="allow-same-origin allow-scripts" // Security best practice
          />
        </div>
      </div>
    </div>
  );
}