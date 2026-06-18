// src/components/MassTaggerModal.jsx
import { useState } from 'react';
import { useStore } from '../store';

export default function MassTaggerModal() {
  const { isMassTaggerOpen, setMassTaggerOpen, executeBulkTag, selectedBookmarks } = useStore();
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");

  if (!isMassTaggerOpen) return null;

  const closeModal = () => {
    setAddTags("");
    setRemoveTags("");
    setMassTaggerOpen(false);
  };

  const handleSubmit = () => {
    executeBulkTag(addTags, removeTags);
    closeModal();
  };

  return (
    <div className="modal-overlay open" onClick={closeModal}>
      <div className="modal-box" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Tag {selectedBookmarks.size} Bookmarks</div>
          <button className="modal-close-btn" onClick={closeModal}>✕</button>
        </div>
        
        <div className="modal-body" style={{ padding: '16px 18px' }}>
          <div className="detail-field">
            <div className="detail-field-label">Add Tags (comma separated)</div>
            <input 
              className="tag-input"
              type="text" 
              placeholder="e.g. reading, tech, inspiration" 
              value={addTags} 
              onChange={e => setAddTags(e.target.value)} 
            />
          </div>
          <div className="detail-field" style={{ marginTop: '16px' }}>
            <div className="detail-field-label">Remove Tags (comma separated)</div>
            <input 
              className="tag-input"
              type="text" 
              placeholder="e.g. read-later, obsolete" 
              value={removeTags} 
              onChange={e => setRemoveTags(e.target.value)} 
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>Apply Tags</button>
        </div>
      </div>
    </div>
  );
}