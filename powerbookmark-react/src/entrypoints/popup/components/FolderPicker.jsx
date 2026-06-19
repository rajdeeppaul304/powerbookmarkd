import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function FolderPicker({ vault, selected, onSelect }) {
    const [stack, setStack] = useState([{ id: null, name: 'Root' }]);
    const [items, setItems] = useState([]);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const breadcrumbRef = useRef(null);

    const current = stack[stack.length - 1];

    useEffect(() => {
        loadItems(current.id);
    }, [current.id, vault]);

    // Auto-select current location when navigating
    useEffect(() => {
        onSelect({ id: current.id, name: current.name });
    }, [current]);

    async function loadItems(folderId) {
        try {
            const data = await api.getContents(vault, folderId);
            setItems(data.subfolders || []);
        } catch {
            setItems([]);
        }
    }

    function navigateTo(id, name) {
        if (id === null) {
            setStack([{ id: null, name: 'Root' }]);
        } else {
            const top = stack[stack.length - 1];
            if (top.id !== id) setStack(s => [...s, { id, name }]);
        }
    }

    function goBack() {
        if (stack.length <= 1) return;
        setStack(s => s.slice(0, -1));
    }

    function toggleSelect(f) {
        if (selected?.id === f.id) {
            onSelect({ id: current.id, name: current.name });
        } else {
            onSelect({ id: f.id, name: f.name });
        }
    }

    async function createFolder() {
        if (!newName.trim()) return;
        try {
            const res = await chrome.runtime.sendMessage({
                type: 'CREATE_FOLDER',
                name: newName.trim(),
                parent_id: current.id,
                vault
            });
            if (res.success) {
                setCreating(false);
                setNewName('');
                await loadItems(current.id);
                onSelect({ id: res.folder.id, name: res.folder.name });
            }
        } catch (e) {
            console.error(e);
        }
    }

    // Restore folder from a saved folder_id
    async function restoreFolder(folderId) {
        if (!folderId) { setStack([{ id: null, name: 'Root' }]); return; }
        try {
            const data = await api.getFolderPath(folderId);
            const breadcrumb = data.breadcrumb || [];
            if (!breadcrumb.length) return;
            const newStack = [{ id: null, name: 'Root' }, ...breadcrumb.slice(0, -1).map(n => ({ id: n.id, name: n.name }))];
            setStack(newStack);
            // items will load via useEffect, then we select the target
            const target = items.find(f => f.id === folderId);
            if (target) onSelect({ id: target.id, name: target.name });
        } catch {
            setStack([{ id: null, name: 'Root' }]);
        }
    }

    const isSelectedHere = selected?.id === current.id;

    useEffect(() => {
    if (breadcrumbRef.current) {
        breadcrumbRef.current.scrollLeft = breadcrumbRef.current.scrollWidth;
    }
}, [stack]);

    return (
        <div className="folder-nav">
            {/* Breadcrumb */}
            <div className="fnav-breadcrumb" ref={breadcrumbRef}>

                {stack.map((crumb, i) => (
                    <span key={i}>
                        {i > 0 && <span className="fnav-sep"> › </span>}
                        <span
                            className={`fnav-crumb ${i === stack.length - 1 ? 'current' : ''}`}
                            onClick={() => {
                                if (i < stack.length - 1) {
                                    setStack(s => s.slice(0, i + 1));
                                }
                            }}
                        >
                            {i === 0 ? '📂 Root' : `📁 ${crumb.name}`}
                        </span>
                    </span>
                ))}
            </div>

            {/* Toolbar */}
            <div className="fnav-toolbar">
                <button className="fnav-back" disabled={stack.length <= 1} onClick={goBack}>← Back</button>

                {/* Select current location button */}
                {isSelectedHere ? (
                    <span style={{ fontSize: 11, color: 'var(--green)', padding: '4px 8px' }}>✓ Saving here</span>
                ) : (
                    <button className="fnav-new" style={{ color: 'var(--blue)', borderColor: 'var(--blue)' }}
                        onClick={() => onSelect({ id: current.id, name: current.name })}>
                        ← Re-select {current.name}
                    </button>
                )}

                <div className="fnav-spacer" />

                {!creating ? (
                    <button className="fnav-new" onClick={() => setCreating(true)}>＋ New folder</button>
                ) : (
                    <div className="fnav-create-wrap show">
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="Folder name…"
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === 'Enter') createFolder();
                                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                            }}
                        />
                        <button className="fnav-create-ok" onClick={createFolder}>Add</button>
                        <button className="fnav-create-cancel" onClick={() => { setCreating(false); setNewName(''); }}>✕</button>
                    </div>
                )}
            </div>

            {/* Folder list */}
            <div className="fnav-list">
                {items.length === 0 ? (
                    <div className="fnav-empty">No subfolders here</div>
                ) : items.map(f => (
                    <div key={f.id} className="fnav-row" style={{ cursor: 'pointer' }}
                        onClick={() => navigateTo(f.id, f.name)}>
                        <span className="fnav-row-icon">📁</span>
                        <span className="fnav-row-name">{f.name}</span>
                        <button
                            className={`fnav-row-select ${selected?.id === f.id ? 'selected' : ''}`}
                            onClick={e => { e.stopPropagation(); toggleSelect(f); }}
                        >
                            {selected?.id === f.id ? '✓' : 'Select'}
                        </button>
                    </div>
                ))}
            </div>

            {/* Destination bar */}
            <div className="fnav-destination">
                <span className="fnav-dest-label">Save to:</span>
                <span className="fnav-dest-value">
                    {selected ? `📁 ${selected.name}` : '📂 Root'}
                </span>
                <button className="fnav-dest-clear"
                    onClick={() => onSelect({ id: current.id, name: current.name })}>✕</button>
            </div>
        </div>
    );
}