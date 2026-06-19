import { useState, useEffect } from 'react';
import { api } from '../api';
import { loadLastFolder, saveLastFolder } from '../hooks/useLastFolder';
import FolderPicker from './FolderPicker';
import TagInput from './TagInput';

function toast(msg, dur = 2000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
}

const STATUS_LABELS = {
    unsaved: 'Not Saved', saved: '✓ Saved',
    archived: '📦 Archived', error: 'Error', loading: '…'
};

export default function SaveTab({ currentTab, vaults, selectedVault, setSelectedVault, offline }) {
    const [status, setStatus] = useState('unsaved');
    const [bookmarkId, setBookmarkId] = useState(null);
    const [tags, setTags] = useState('');
    const [notes, setNotes] = useState('');
    const [doScreenshot, setDoScreenshot] = useState(true);
    const [doArchive, setDoArchive] = useState(false);
    const [selected, setSelected] = useState({ id: null, name: 'Root' });
    const [isDuplicate, setIsDuplicate] = useState(false);

    useEffect(() => {
        if (!currentTab?.url) return;
        lookup();
    }, [currentTab]);

    async function lookup() {
        try {
            const data = await api.lookupUrl(currentTab.url);
            if (data.exists) {
                const bm = await api.getBookmark(data.bookmark_id);
                setBookmarkId(bm.id);
                setSelectedVault(bm.vault || 'default');
                setTags((bm.tags || []).join(', '));
                setNotes(bm.notes || '');
                setDoArchive(!!bm.archived);
                setIsDuplicate(true);
                setStatus(bm.archived ? 'archived' : 'saved');
                if (bm.folder_id) {
                    setSelected({ id: bm.folder_id, name: bm.folder_id }); // FolderPicker will resolve name
                }
            } else {
                setIsDuplicate(false);
                setStatus('unsaved');
                const last = await loadLastFolder();
                if (last) {
                    setSelectedVault(last.vault || 'default');
                    if (last.folder_id) setSelected({ id: last.folder_id, name: last.folder_name || '' });
                }
            }
        } catch {
            setStatus('error');
        }
    }

    async function handleSave() {
        setStatus('loading');
        const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

        try {
            const res = await chrome.runtime.sendMessage({
                type: 'SAVE',
                tabId: currentTab.id,
                url: currentTab.url,
                title: currentTab.title,
                vault: selectedVault,
                tags: tagList,
                archive: doArchive,
                screenshot: doScreenshot,  // ← add this
                notes,
                folder_id: selected?.id || null,
                favicon_url: currentTab.favIconUrl,
            });

            if (res.success) {
                setBookmarkId(res.id);
                setIsDuplicate(true);
                setStatus(doArchive ? 'archived' : 'saved');
                toast('✓ Bookmark saved');
                await saveLastFolder(selectedVault, selected?.id || null, selected?.name || null);
            } else {
                throw new Error(res.error || 'Unknown error');
            }
        } catch (e) {
            setStatus('error');
            toast('❌ Save failed: ' + e.message);
        }
    }

    async function handleDelete() {
        if (!bookmarkId || !confirm('Delete this bookmark?')) return;
        try {
            const res = await chrome.runtime.sendMessage({ type: 'DELETE', id: bookmarkId, tabId: currentTab.id });
            if (res.success) {
                setBookmarkId(null);
                setIsDuplicate(false);
                setTags(''); setNotes('');
                setSelected({ id: null, name: 'Root' });
                setStatus('unsaved');
                toast('🗑 Bookmark deleted');
            }
        } catch (e) {
            toast('❌ Delete failed: ' + e.message);
        }
    }

    return (
        <div className="panel active" id="panel-save">
            <div className="save-panel">
                {/* Status chip */}
                <div style={{ marginBottom: 10 }}>
                    <span className={`status-chip ${status}`}>{STATUS_LABELS[status] || status}</span>
                </div>

                {/* Page info */}
                <div className="page-info">
                    <div className="page-title">{currentTab?.title || 'Loading…'}</div>
                    <div className="page-url">{currentTab?.url || ''}</div>
                </div>

                {/* Duplicate warning */}
                {isDuplicate && (
                    <div className="duplicate-warning show">
                        <div className="dup-title">⚠ Already saved</div>
                        <div className="dup-text">This URL exists in your bookmarks. Saving will update it.</div>
                    </div>
                )}

                {/* Vault */}
                <div className="field">
                    <label>Vault</label>
                    <select value={selectedVault} onChange={e => setSelectedVault(e.target.value)}>
                        {vaults.map(v => (
                            <option key={v.name} value={v.name}>
                                📁 {v.name} ({v.count})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Folder picker */}
                <div className="field">
                    <label>Folder</label>
                    <FolderPicker
                        vault={selectedVault}
                        selected={selected}
                        onSelect={setSelected}
                    />
                </div>

                {/* Tags */}
                <div className="field">
    <label>Tags (comma separated)</label>
    <TagInput value={tags} onChange={setTags} />
</div>

                {/* Notes */}
                <div className="field">
                    <label>Notes</label>
                    <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={2}
                        placeholder="Optional note…"
                        style={{ resize: 'vertical', minHeight: 50 }}
                    />
                </div>

                {/* Toggles */}
                <div className="toggles">
                    <div className={`toggle-item ${doScreenshot ? 'on' : ''}`}
                        onClick={() => setDoScreenshot(s => !s)}>
                        <span className="toggle-icon">📸</span>
                        <span className="toggle-label">Screenshot</span>
                    </div>
                    <div className={`toggle-item ${doArchive ? 'on' : ''}`}
                        onClick={() => setDoArchive(a => !a)}>
                        <span className="toggle-icon">📦</span>
                        <span className="toggle-label">Archive HTML</span>
                    </div>
                </div>

                {/* Buttons */}
                <div className="btn-row">
                    {isDuplicate && (
                        <button className="btn-danger" onClick={handleDelete}>Delete</button>
                    )}
                    <button
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={offline || status === 'loading'}
                    >
                        {isDuplicate ? 'Update Bookmark' : 'Save Bookmark'}
                    </button>
                </div>
            </div>
        </div>
    );
}