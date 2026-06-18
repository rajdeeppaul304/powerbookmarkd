// src/components/MassMoveModal.jsx
import { useState } from 'react';
import { useStore } from '../store';

export default function MassMoveModal() {
  const { isMassMoveOpen, setMassMoveOpen, moveItemsToFolder, selectedBookmarks, selectedFolders, vaults, folders } = useStore();
  const [targetVault, setTargetVault] = useState("default");
  const [targetFolder, setTargetFolder] = useState("");

  if (!isMassMoveOpen) return null;

  const total = selectedBookmarks.size + selectedFolders.size;

  const closeModal = () => {
    setTargetFolder("");
    setMassMoveOpen(false);
  };

  const handleMove = async () => {
    const bIds = Array.from(selectedBookmarks);
    const fIds = Array.from(selectedFolders);
    
    // Pass null if they selected "-- Root --", otherwise pass the ID
    await moveItemsToFolder(bIds, fIds, targetFolder || null);
    closeModal();
  };

  return (
    <div className="modal-overlay open" onClick={closeModal}>
      <div className="modal-box" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Move {total} Items</div>
          <button className="modal-close-btn" onClick={closeModal}>✕</button>
        </div>
        
        <div className="modal-body" style={{ padding: '16px 18px' }}>
          <div className="detail-field">
            <div className="detail-field-label">Destination Vault</div>
            <select className="tag-input" value={targetVault} onChange={e => setTargetVault(e.target.value)}>
              {vaults.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>

          <div className="detail-field" style={{ marginTop: '16px' }}>
            <div className="detail-field-label">Destination Folder</div>
            <select className="tag-input" value={targetFolder} onChange={e => setTargetFolder(e.target.value)}>
              <option value="">— Root (No Folder) —</option>
              {folders.filter(f => f.vault === targetVault).map(f => (
                <option key={f.id} value={f.id}>📁 {f.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMove}>Move Items</button>
        </div>
      </div>
    </div>
  );
}