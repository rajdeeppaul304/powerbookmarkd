import { useState } from 'react';
import { api, API_URL } from '../api';

function escHtml(str = '') {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function ExplorerTab({ selectedVault }) {
    const [stack, setStack] = useState([{ id: null, name: 'Root' }]);
    const [contents, setContents] = useState({ folders: [], bookmarks: [] });
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState(false);
    const [searchScope, setSearchScope] = useState(null);
    const [loading, setLoading] = useState(false);
    const [initialized, setInitialized] = useState(false);

    const current = stack[stack.length - 1];

    async function navigateTo(id, name) {
        setSearchMode(false);
        setSearchQuery('');

        let newStack;
        if (id === null) {
            newStack = [{ id: null, name: 'Root' }];
        } else {
            const top = stack[stack.length - 1];
            newStack = top.id !== id ? [...stack, { id, name }] : stack;
        }
        setStack(newStack);

        setLoading(true);
        try {
            const data = await api.getContents(selectedVault, id);
            if (data.ordered_items?.length) {
                setContents({
                    folders: data.ordered_items.filter(i => i.item_type === 'folder'),
                    bookmarks: data.ordered_items.filter(i => i.item_type === 'bookmark'),
                });
            } else {
                setContents({ folders: data.subfolders || [], bookmarks: data.bookmarks || [] });
            }
        } catch {
            setContents({ folders: [], bookmarks: [] });
        } finally {
            setLoading(false);
            setInitialized(true);
        }
    }

    function goBack() {
        if (stack.length <= 1) return;
        const newStack = stack.slice(0, -1);
        setStack(newStack);
        navigateTo(newStack[newStack.length - 1].id, newStack[newStack.length - 1].name);
    }

    async function doSearch(scope) {
        const q = searchQuery.trim();
        if (!q) return;
        setSearchMode(true);
        setSearchScope(scope);
        setLoading(true);
        try {
            const folderId = scope === 'local' ? current.id : null;
            const data = await api.search(q, selectedVault, folderId);
            setContents({ folders: [], bookmarks: data.results || [] });
        } catch {
            setContents({ folders: [], bookmarks: [] });
        } finally {
            setLoading(false);
        }
    }

    // Lazy init on first render
    if (!initialized && !loading) navigateTo(null, 'Root');

    return (
        <div className="panel active" id="panel-explorer">
            <div className="explorer-panel">

                {/* Search bar */}
                <div className="exp-search-bar">
                    <div className="exp-search-wrap">
                        <span className="exp-search-icon">🔍</span>
                        <input
                            type="text"
                            value={searchQuery}
                            placeholder="Search… (Enter = local)"
                            onChange={e => {
                                setSearchQuery(e.target.value);
                                if (!e.target.value.trim() && searchMode) {
                                    setSearchMode(false);
                                    navigateTo(current.id, current.name);
                                }
                            }}
                            onKeyDown={e => e.key === 'Enter' && doSearch('local')}
                        />
                    </div>
                    <button
                        className={`exp-scope-btn ${searchMode && searchScope === 'local' ? 'active-scope' : ''}`}
                        onClick={() => doSearch('local')}
                    >Local</button>
                    <button
                        className={`exp-scope-btn ${searchMode && searchScope === 'global' ? 'active-scope' : ''}`}
                        onClick={() => doSearch('global')}
                    >Global</button>
                </div>

                {/* Nav bar */}
                <div className="exp-nav-bar">
                    <button className="exp-back fnav-back" disabled={stack.length <= 1} onClick={goBack}>← Back</button>
                    <div className="fnav-breadcrumb" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                        {stack.map((crumb, i) => (
                            <span key={i}>
                                {i > 0 && <span className="fnav-sep"> › </span>}
                                <span
                                    className={`fnav-crumb ${i === stack.length - 1 ? 'current' : ''}`}
                                    onClick={() => {
                                        if (i < stack.length - 1) {
                                            const newStack = stack.slice(0, i + 1);
                                            setStack(newStack);
                                            navigateTo(crumb.id, crumb.name);
                                        }
                                    }}
                                >
                                    {i === 0 ? '📂 Root' : `📁 ${crumb.name}`}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Contents */}
                <div className="exp-contents">
                    {loading ? (
                        <div className="exp-empty"><div className="empty-icon">⏳</div>Loading…</div>
                    ) : searchMode ? (
                        <>
                            <div className="exp-search-hdr">
                                <span className="exp-search-scope">
                                    {searchScope === 'local' ? `📁 ${current.name || 'Root'} & subfolders` : '🌐 All vaults'}
                                </span>
                                <span className="exp-search-count">{contents.bookmarks.length} results</span>
                            </div>
                            {contents.bookmarks.length === 0
                                ? <div className="exp-empty"><div className="empty-icon">🔍</div>No results</div>
                                : contents.bookmarks.map(bm => (
                                    <BookmarkRow key={bm.id} bm={bm} showFolder />
                                ))
                            }
                        </>
                    ) : contents.folders.length === 0 && contents.bookmarks.length === 0 ? (
                        <div className="exp-empty"><div className="empty-icon">📂</div>This folder is empty</div>
                    ) : (
                        <>
                            {contents.folders.map(f => (
                                <FolderRow key={f.id} folder={f} onNavigate={navigateTo} />
                            ))}
                            {contents.bookmarks.map(bm => (
                                <BookmarkRow key={bm.id} bm={bm} />
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function FolderRow({ folder, onNavigate }) {
    const sf = folder.subfolder_count || 0;
    const bm = folder.bookmark_count || 0;
    const parts = [];
    if (sf) parts.push(`${sf} folder${sf !== 1 ? 's' : ''}`);
    if (bm) parts.push(`${bm} bookmark${bm !== 1 ? 's' : ''}`);

    return (
        <div className="exp-row exp-folder" onClick={() => onNavigate(folder.id, folder.name)}>
            <span className="exp-row-icon">📁</span>
            <div className="exp-row-info">
                <div className="exp-row-name">{folder.name}</div>
                <div className="exp-row-meta">{parts.join(' · ') || 'Empty'}</div>
            </div>
            <span className="exp-row-arrow">›</span>
        </div>
    );
}

function BookmarkRow({ bm, showFolder = false }) {
    const favSrc = bm.favicon_path
        ? `${API_URL}/static/favicons/${bm.id}.ico`
        : bm.favicon_url || null;

    return (
        <div className="exp-row exp-bookmark" onClick={() => chrome.tabs.create({ url: bm.url })}>
            <div className="exp-thumb">
                {bm.screenshot
                    ? <img src={`${API_URL}/static/archive/${bm.id}.jpeg`}
                        onError={e => { e.target.style.display = 'none'; }}
                        alt="" />
                    : favSrc
                        ? <img src={favSrc} style={{ width: 20, height: 20, objectFit: 'contain' }} alt="" />
                        : '🔖'
                }
            </div>
            <div className="exp-row-info">
                <div className="exp-row-name">{bm.title || bm.url}</div>
                <div className="exp-row-url">{bm.url}</div>
                <div className="exp-row-badges">
                    {showFolder && bm.folder_name && (
                        <span className="badge folder">📁 {bm.folder_name}</span>
                    )}
                    {(bm.tags || []).slice(0, 3).map(t => (
                        <span key={t} className="badge tag">{t}</span>
                    ))}
                </div>
            </div>
        </div>
    );
}