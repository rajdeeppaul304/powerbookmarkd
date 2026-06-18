// src/components/NewFolderModal.jsx
import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function NewFolderModal() {
    const { isNewFolderOpen, setNewFolderOpen, currentFilter, vaults, addFolder, folders } = useStore();
    const [name, setName] = useState('');
    const parentFolder = currentFilter.type === 'folder' ? folders.find(f => f.id === currentFilter.value) : null;
    // Default to current vault or first available
    const currentVault = currentFilter.type === 'vault' ? currentFilter.value : (vaults[0]?.name || 'default');
    const [vault, setVault] = useState(currentVault);

    if (!isNewFolderOpen) return null;

    const handleSave = async () => {
        if (!name.trim()) return;
        const parent_id = currentFilter.type === 'folder' ? currentFilter.value : null;

        try {
            const newFolder = await api.createFolder({ name, vault, parent_id });
            addFolder(newFolder); // Instantly adds it to the sidebar!
            closeModal();
        } catch (err) {
            alert("Failed to create folder: " + err.message);
        }
    };

    const closeModal = () => {
        setName('');
        setNewFolderOpen(false);
    };

    return (
        <div className="modal-overlay open">
            <div className="modal-box">
                <div className="modal-header">
                    <div className="modal-title">New Folder</div>
                    <button className="modal-close-btn" onClick={closeModal}>✕</button>
                </div>
                <div className="modal-body" style={{ padding: '16px 18px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12, fontFamily: 'monospace' }}>
                        Inside: {parentFolder ? `📁 ${parentFolder.name}` : '🗂 Root'}          </div>

                    <div className="detail-field">
                        <div className="detail-field-label">Folder Name</div>
                        <input
                            className="tag-input"
                            placeholder="e.g. Inspiration, Recipes"
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSave()}
                        />
                    </div>

                    <div className="detail-field">
                        <div className="detail-field-label">Vault</div>
                        <select className="tag-input" value={vault} onChange={e => setVault(e.target.value)}>
                            {vaults.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave}>Create Folder</button>
                </div>
            </div>
        </div>
    );
}