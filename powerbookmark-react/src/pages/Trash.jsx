import { useState, useEffect } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export default function Trash() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(new Set());
    const { silentSync } = useStore();

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.getTrash();
            setItems(res.items || []);
        } catch (err) {
            alert("Failed to load trash: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const toggleSelect = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };

    const toggleAll = () => {
        if (selected.size === items.length) setSelected(new Set());
        else setSelected(new Set(items.map(i => i.id)));
    };

    const handleRestore = async () => {
        if (!selected.size) return;
        try {
            await api.restoreTrash(Array.from(selected));
            await silentSync();
            await load();
            setSelected(new Set());
        } catch (err) {
            alert("Failed to restore: " + err.message);
        }
    };

    const handlePurge = async () => {
        if (!selected.size) return;
        if (!window.confirm(`Permanently delete ${selected.size} item(s)? This cannot be undone.`)) return;
        try {
            await api.purgeTrash(Array.from(selected));
            await load();
            setSelected(new Set());
        } catch (err) {
            alert("Failed to purge: " + err.message);
        }
    };

    const formatDate = (iso) => new Date(iso).toLocaleString();

    const getLabel = (item) => {
        const folders = item.data.folders?.length || 0;
        const bookmarks = item.data.bookmarks?.length || 0;
        const parts = [];
        if (folders) parts.push(`${folders} folder${folders > 1 ? 's' : ''}`);
        if (bookmarks) parts.push(`${bookmarks} bookmark${bookmarks > 1 ? 's' : ''}`);
        return parts.join(' + ');
    };

    const getTitle = (item) => {
        // Use top level folder name if exists, else first bookmark title
        const topFolder = item.data.folders?.find(f => !item.data.folders.some(
            p => p.id === f.parent_id
        ));
        if (topFolder) return `📁 ${topFolder.name}`;
        const bm = item.data.bookmarks?.[0];
        if (bm) return `🔖 ${bm.title || bm.url}`;
        return 'Unknown';
    };

    const daysLeft = (deletedAt) => {
        const expiry = new Date(deletedAt);
        expiry.setDate(expiry.getDate() + 7);
        const diff = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));
        return Math.max(0, diff);
    };

    if (loading) return (
        <main className="main" style={{ padding: '40px' }}>
            <div className="empty-state">Loading trash...</div>
        </main>
    );

    return (
        <main className="main" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <h1 style={{ margin: 0 }}>🗑 Trash</h1>
                <p style={{ margin: 0, color: 'var(--text3)', fontSize: '13px' }}>
                    Items are permanently deleted after 7 days
                </p>
            </div>

            {items.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">🗑</div>
                    <div className="empty-title">Trash is empty</div>
                    <div className="empty-sub">Deleted items will appear here for 7 days.</div>
                </div>
            ) : (
                <section style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    {/* Bulk actions bar */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
                        <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} />
                        <span style={{ fontSize: '13px', color: 'var(--text2)', marginRight: 'auto' }}>
                            {selected.size > 0 ? `${selected.size} selected` : `${items.length} item${items.length > 1 ? 's' : ''} in trash`}
                        </span>
                        <button
                            className="btn btn-secondary"
                            style={{ opacity: selected.size ? 1 : 0.4, pointerEvents: selected.size ? 'auto' : 'none' }}
                            onClick={handleRestore}
                        >
                            ↩ Restore
                        </button>
                        <button
                            className="btn btn-danger-outline"
                            style={{ opacity: selected.size ? 1 : 0.4, pointerEvents: selected.size ? 'auto' : 'none' }}
                            onClick={handlePurge}
                        >
                            🗑 Delete Forever
                        </button>
                    </div>

                    {/* Trash items */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {items.map(item => (
                            <div
                                key={item.id}
                                onClick={() => toggleSelect(item.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    padding: '12px 16px', background: 'var(--bg)',
                                    borderRadius: '8px', border: '1px solid var(--border)',
                                    cursor: 'pointer',
                                    outline: selected.has(item.id) ? '2px solid var(--blue)' : 'none',
                                    outlineOffset: '-2px',
                                    backgroundColor: selected.has(item.id) ? 'rgba(59,130,246,0.05)' : '',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(item.id)}
                                    onChange={() => toggleSelect(item.id)}
                                    onClick={e => e.stopPropagation()}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                        {getTitle(item)}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
                                        {getLabel(item)} · Deleted {formatDate(item.deleted_at)}
                                    </div>
                                </div>
                                <div style={{
                                    fontSize: '11px', fontWeight: 600,
                                    color: daysLeft(item.deleted_at) <= 1 ? 'var(--red, #ef4444)' : 'var(--text3)',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {daysLeft(item.deleted_at)}d left
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}