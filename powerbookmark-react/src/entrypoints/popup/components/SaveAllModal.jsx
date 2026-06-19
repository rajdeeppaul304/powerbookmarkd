import { useState } from 'react';
import { api } from '../api';

export default function SaveAllModal({ tabs, onConfirm, onCancel }) {
    const [showDetails, setShowDetails] = useState(false);
    const [details, setDetails] = useState({}); // { url: { vault, path } }
    const [loadingDetails, setLoadingDetails] = useState(false);

    const duplicates = tabs.filter(t => t.exists);
    const newTabs = tabs.filter(t => !t.exists);

    async function handleShowDetails() {
        setShowDetails(true);
        if (Object.keys(details).length > 0) return; // already fetched

        setLoadingDetails(true);
        const result = {};

        for (const tab of duplicates) {
            try {
                const bm = await api.getBookmark(tab.bookmarkId);
                let path = bm.vault;

                if (bm.folder_id) {
                    const pathData = await api.getFolderPath(bm.folder_id);
                    const chain = (pathData.breadcrumb || []).map(p => p.name).join(' / ');
                    path = `${bm.vault} → 📁 ${chain}`;
                } else {
                    path = `${bm.vault} → Root`;
                }

                result[tab.url] = { path };
            } catch {
                result[tab.url] = { path: 'Unknown location' };
            }
        }

        setDetails(result);
        setLoadingDetails(false);
    }

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 999
        }}>
            <div style={{
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
                width: 460,
                maxHeight: 500,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
            }}>
                {/* Header */}
                <div style={{ fontSize: 15, fontWeight: 600 }}>📑 Save All Tabs</div>

                {/* Summary */}
                <div style={{
                    background: 'var(--bg3)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    fontSize: 13,
                }}>
                    <div>🔢 <b>{tabs.length}</b> tabs total</div>
                    <div style={{ color: 'var(--green)' }}>✨ <b>{newTabs.length}</b> new</div>
                    {duplicates.length > 0 && (
                        <div style={{ color: 'var(--yellow)' }}>⚠ <b>{duplicates.length}</b> already saved</div>
                    )}
                </div>

                {/* Details toggle */}
                {duplicates.length > 0 && (
                    <div>
                        <button
                            onClick={handleShowDetails}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--blue)',
                                fontSize: 12,
                                cursor: 'pointer',
                                padding: 0,
                                fontFamily: 'inherit',
                            }}
                        >
                            {showDetails ? '▾ Hide details' : '▸ See details'}
                        </button>

                        {showDetails && (
                            <div style={{
                                marginTop: 8,
                                maxHeight: 180,
                                overflowY: 'auto',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                            }}>
                                {loadingDetails ? (
                                    <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>
                                        Loading locations…
                                    </div>
                                ) : duplicates.map(tab => (
                                    <div key={tab.url} style={{
                                        background: 'var(--bg3)',
                                        borderRadius: 6,
                                        padding: '8px 10px',
                                        fontSize: 11,
                                    }}>
                                        <div style={{
                                            color: 'var(--text)',
                                            fontWeight: 500,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            marginBottom: 3,
                                        }}>
                                            {tab.title || tab.url}
                                        </div>
                                        <div style={{ color: 'var(--text3)' }}>
                                            {details[tab.url]
                                                ? `📍 ${details[tab.url].path}`
                                                : '…'
                                            }
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                        onClick={onCancel}
                        style={{
                            flex: 1, padding: '8px 0',
                            background: 'var(--bg3)',
                            border: '1px solid var(--border)',
                            borderRadius: 8, color: 'var(--text2)',
                            fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit',
                        }}
                    >
                        Cancel
                    </button>
                    {duplicates.length > 0 && (
                        <button
                            onClick={() => onConfirm('new-only')}
                            style={{
                                flex: 1, padding: '8px 0',
                                background: 'var(--bg3)',
                                border: '1px solid var(--blue)',
                                borderRadius: 8, color: 'var(--blue)',
                                fontSize: 13, fontWeight: 600,
                                cursor: 'pointer', fontFamily: 'inherit',
                            }}
                        >
                            Save New Only
                        </button>
                    )}
                    <button
                        onClick={() => onConfirm('all')}
                        style={{
                            flex: 1, padding: '8px 0',
                            background: 'var(--blue)',
                            border: 'none',
                            borderRadius: 8, color: 'white',
                            fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit',
                        }}
                    >
                        Save All
                    </button>
                </div>
            </div>
        </div>
    );
}