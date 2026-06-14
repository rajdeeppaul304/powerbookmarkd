// src/components/BulkFetchModal.jsx
import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function BulkFetchModal() {
  const { isBulkFetchOpen, setBulkFetchOpen, targetFetchIds, clearSelection } = useStore();
  const [doArchive, setDoArchive] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  if (!isBulkFetchOpen) return null;

  const handleFetch = async () => {
    setIsFetching(true);
    try {
      const data = await api.bulkFetch(targetFetchIds, doArchive);
      alert(`Successfully fetched ${data.successful_count} out of ${data.total_requested} items!`);
      // Note: We'll add the background-sync polling later so the UI updates with the new screenshots automatically
      
      closeModal();
      clearSelection();
    } catch (err) {
      alert("Fetch failed: " + err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const closeModal = () => {
    setDoArchive(false);
    setBulkFetchOpen(false);
  };

  return (
    <div className="modal-overlay open">
      <div className="modal-box" style={{ width: 420 }}>
        <div className="modal-header">
          <div className="modal-title">Bulk Fetch ({targetFetchIds.length} items)</div>
          <button className="modal-close-btn" onClick={closeModal} disabled={isFetching}>✕</button>
        </div>
        
        <div className="modal-body" style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
            This will spin up a background browser to visit each selected bookmark.
          </p>
          
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, opacity: 0.8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text)' }}>
              <input type="checkbox" checked disabled style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
              <div>
                <div style={{ fontWeight: 500 }}>📸 Grab Screenshots</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Always enabled. Updates the thumbnail image.</div>
              </div>
            </label>
          </div>

          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={doArchive} onChange={e => setDoArchive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
              <div>
                <div style={{ fontWeight: 500 }}>📦 Archive HTML</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Downloads the full DOM for offline reading. (Slower)</div>
              </div>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal} disabled={isFetching}>Cancel</button>
          <button className="btn btn-primary" onClick={handleFetch} disabled={isFetching}>
            {isFetching ? 'Fetching...' : 'Start Fetching'}
          </button>
        </div>
      </div>
    </div>
  );
}