import { useState } from 'react';
import { useStore } from '../store';

export default function DeleteConfirmationModal() {
  const { pendingDeletionPayload, confirmDeletion, cancelDeletion } = useStore();
  const [remember, setRemember] = useState(false);

  if (!pendingDeletionPayload) return null;

  const bmCount = pendingDeletionPayload.bookmarkIds?.length || 0;
  const folCount = pendingDeletionPayload.folderIds?.length || 0;
  const total = bmCount + folCount;

  return (
    <div className="modal-overlay open" onClick={cancelDeletion}>
      <div
        className="modal-box"
        style={{ width: 420 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            Delete {total} Item{total !== 1 ? 's' : ''}?
          </div>
          <button className="modal-close-btn" onClick={cancelDeletion}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ padding: '16px 18px' }}>
          <p
            style={{
              color: 'var(--text2)',
              fontSize: '14px',
              lineHeight: '1.5',
              margin: 0,
            }}
          >
            Are you sure you want to permanently delete these items? This
            action cannot be undone.
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: '18px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text)',
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            Don't ask me again
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={cancelDeletion}>
            Cancel
          </button>

          <button
            className="btn btn-danger"
            onClick={() => confirmDeletion(remember)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}