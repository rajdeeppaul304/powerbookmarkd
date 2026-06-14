// src/components/NewBookmarkModal.jsx
import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function NewBookmarkModal() {
  const { isNewBookmarkOpen, setNewBookmarkOpen, currentFilter, vaults, folders, addBookmark } = useStore();
  
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [doArchive, setDoArchive] = useState(false);
  const [targetFolder, setTargetFolder] = useState(currentFilter.type === 'folder' ? currentFilter.value : '');
  const [targetVault, setTargetVault] = useState(currentFilter.type === 'vault' ? currentFilter.value : (vaults[0]?.name || 'default'));
  
  const [isFetching, setIsFetching] = useState(false);
  const [fetchedImage, setFetchedImage] = useState(null);

  if (!isNewBookmarkOpen) return null;

  const handleFetch = async () => {
    if (!url.startsWith('http')) return;
    setIsFetching(true);
    try {
      const data = await api.fetchMeta(url, doArchive);
      if (data.title && !title) setTitle(data.title);
      if (data.screenshot) setFetchedImage(data.screenshot);
    } catch {
      // Silently fail, user can input manually
    } finally {
      setIsFetching(false);
    }
  };

  const handleSave = async () => {
    if (!url.trim()) return;
    
    const parsedTags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const body = {
      url, title: title || url, vault: targetVault, tags: parsedTags, notes,
      folder_id: targetFolder || null, screenshot: !!fetchedImage, archive: doArchive
    };

    try {
      const saved = await api.saveBookmark(body);
      
      // Inject the optimistic object immediately
      addBookmark({
        id: saved.id, ...body, created_at: new Date().toISOString(),
        html_path: doArchive ? 'ready' : null, favicon_path: 'ready'
      });
      
      closeModal();
    } catch (err) {
      alert("Failed to save: " + err.message);
    }
  };

  const closeModal = () => {
    setUrl(''); setTitle(''); setTags(''); setNotes(''); setFetchedImage(null);
    setNewBookmarkOpen(false);
  };

  return (
    <div className="modal-overlay open">
      <div className="modal-box" style={{ width: 480 }}>
        <div className="modal-header">
          <div className="modal-title">New Bookmark</div>
          <button className="modal-close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '16px 18px' }}>
          
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="detail-field">
                <div className="detail-field-label">URL *</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                  <input className="tag-input" style={{ marginTop: 0 }} placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} />
                  <button className="btn btn-secondary" style={{ padding: '0 12px' }} onClick={handleFetch} disabled={isFetching}>
                    {isFetching ? '⏳' : '⚡ Fetch'}
                  </button>
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-field-label">Title</div>
                <input className="tag-input" placeholder="Auto-fetched if blank" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
            </div>
            
            <div style={{ width: 100 }}>
              <div className="detail-field-label">Preview</div>
              <div style={{ width: 100, height: 68, background: 'var(--bg3)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', overflow: 'hidden' }}>
                {fetchedImage ? <img src={fetchedImage} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : <span style={{fontSize: 28}}>🔖</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div className="detail-field" style={{ flex: 1, marginBottom: 0 }}>
              <div className="detail-field-label">Vault</div>
              <select className="tag-input" value={targetVault} onChange={e => setTargetVault(e.target.value)}>
                {vaults.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </div>
            <div className="detail-field" style={{ flex: 1, marginBottom: 0 }}>
              <div className="detail-field-label">Folder</div>
              <select className="tag-input" value={targetFolder} onChange={e => setTargetFolder(e.target.value)}>
                <option value="">— No folder —</option>
                {folders.filter(f => !f.parent_id).map(f => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
              </select>
            </div>
          </div>

          <div className="detail-field">
            <div className="detail-field-label">Tags</div>
            <input className="tag-input" placeholder="design, frontend (comma separated)" value={tags} onChange={e => setTags(e.target.value)} />
          </div>

          <div className="detail-field" style={{ marginBottom: 0 }}>
            <div className="detail-field-label">Notes</div>
            <textarea className="tag-input" rows="2" value={notes} onChange={e => setNotes(e.target.value)}></textarea>
          </div>

          <div className="detail-field" style={{ marginTop: 16, marginBottom: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={doArchive} onChange={e => setDoArchive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
              📦 Archive HTML (Saves full page content)
            </label>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Bookmark</button>
        </div>
      </div>
    </div>
  );
}