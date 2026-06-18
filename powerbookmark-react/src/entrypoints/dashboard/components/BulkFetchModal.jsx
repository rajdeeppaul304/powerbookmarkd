import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function BulkFetchModal() {
  const { isBulkFetchOpen, setBulkFetchOpen, targetFetchIds, clearSelection, fetchJobsStatus } = useStore();
  const [doArchive, setDoArchive] = useState(false);

  if (!isBulkFetchOpen) return null;

  const handleFetch = async () => {
    try {
      // 1. Fire the job to the backend
      await api.startFetchJob({
        bookmark_ids: targetFetchIds,
        fetch_screenshot: true, // Always true based on your UI
        fetch_archive: doArchive
      });

      // 2. Instantly refresh the Job Widget so it pops up immediately
      fetchJobsStatus(); 

      // 3. Close the modal and clear the selected items
      closeModal();
      clearSelection();
    } catch (err) {
      alert("Failed to start job: " + err.message);
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
          <button className="modal-close-btn" onClick={closeModal}>✕</button>
        </div>
        
        <div className="modal-body" style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
            This will spin up a background job to visit each selected bookmark. You can safely close this and keep working.
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
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Downloads the full DOM for offline reading.</div>
              </div>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={handleFetch}>
            Start Background Fetch
          </button>
        </div>
      </div>
    </div>
  );
}