// src/components/Sidebar.jsx
import { useNavigate, useLocation } from 'react-router-dom'; // <--- Add this
import { useStore } from '../store';
import FolderTree from './FolderTree';
import { useMemo, useEffect } from 'react';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTagFilters, toggleTagFilter, setTagFilterMode, clearTagFilters, activeVault,
    sidebarPrimaryView, setSidebarPrimaryView,
    sidebarTagsView, toggleSidebarTags,
    vaults, bookmarks, folders, currentFilter, setFilter, isVaultUnlocked, lockVault, setUnlockTarget,
    setNewFolderOpen, setNewBookmarkOpen // <--- ADD THESE TWO
  } = useStore();




  const handleFilterClick = (type, value) => {
    setFilter(type, value);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };


  // Compute tags scoped to current context (recursively)
  const scopedTags = useMemo(() => {
    const getDescendantIds = (folderId) => {
      const result = [];
      const queue = [folderId];
      while (queue.length) {
        const cur = queue.shift();
        const children = folders.filter(f => f.parent_id === cur);
        children.forEach(c => { result.push(c.id); queue.push(c.id); });
      }
      return result;
    };

    let scopedBms = [];
    if (currentFilter.type === 'folder') {
      const ids = [currentFilter.value, ...getDescendantIds(currentFilter.value)];
      scopedBms = bookmarks.filter(b => ids.includes(b.folder_id));
    } else if (currentFilter.type === 'vault') {
      scopedBms = bookmarks.filter(b => b.vault === currentFilter.value);
    } else if (currentFilter.type === 'root') {
      scopedBms = bookmarks.filter(b => b.vault === activeVault);
    } else {
      scopedBms = bookmarks;
    }

    // Prune active tags not present in new scope
    const available = new Set(scopedBms.flatMap(b => b.tags || []));

    // Auto-prune stale active tags (side-effect in memo is not ideal but pragmatic here)
    // const stale = activeTagFilters.tags.filter(t => !available.has(t));
    // if (stale.length > 0) {
    //   // Schedule outside render
    //   setTimeout(() => {
    //     useStore.getState().set(state => ({
    //       activeTagFilters: {
    //         ...state.activeTagFilters,
    //         tags: state.activeTagFilters.tags.filter(t => available.has(t))
    //       }
    //     }));
    //   }, 0);
    // }

    const counts = {};
    scopedBms.forEach(b => (b.tags || []).forEach(t => {
      counts[t] = (counts[t] || 0) + 1;
    }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [bookmarks, folders, currentFilter, activeVault]);

  // Calculate Top Tags dynamically from our bookmarks state
  // const tagCounts = {};
  // bookmarks.forEach(b => (b.tags || []).forEach(t => {
  //   tagCounts[t] = (tagCounts[t] || 0) + 1;
  // }));
  // const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Helper to check if an item is currently selected
  const isActive = (type, value) => currentFilter.type === type && currentFilter.value === value;


  useEffect(() => {
    const available = new Set(scopedTags.map(([t]) => t));
    const stale = activeTagFilters.tags.filter(t => !available.has(t));
    if (stale.length > 0) {
      useStore.setState(state => ({
        activeTagFilters: {
          ...state.activeTagFilters,
          tags: state.activeTagFilters.tags.filter(t => available.has(t))
        }
      }));
    }
  }, [scopedTags]);

  return (
    <aside className="sidebar">
      {/* Action Buttons */}
      <div style={{ padding: '0 14px 14px', display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button className="btn btn-primary" onClick={() => setNewBookmarkOpen(true)} style={{ flex: 1, padding: '6px', fontSize: '12px' }}>+ Bookmark</button>
        <button className="btn btn-secondary" onClick={() => setNewFolderOpen(true)} style={{ flex: 1, padding: '6px', fontSize: '12px' }}>+ Folder</button>
      </div>

      {/* Toggles */}
      <div className="sidebar-toggles">
        <div
          className={`sb-toggle ${sidebarPrimaryView === 'browse' ? 'active' : ''}`}
          onClick={() => setSidebarPrimaryView('browse')}
          title="Browse Bookmarks"
        >🗂</div>
        <div
          className={`sb-toggle ${sidebarPrimaryView === 'vaults' ? 'active' : ''}`}
          onClick={() => setSidebarPrimaryView('vaults')}
          title="Vaults"
        >🏦</div>
        <div
          className={`sb-toggle ${sidebarPrimaryView === 'folders' ? 'active' : ''}`}
          onClick={() => setSidebarPrimaryView('folders')}
          title="Folders"
        >📁</div>
        <div
          className={`sb-toggle ${sidebarTagsView ? 'active' : ''}`}
          onClick={() => toggleSidebarTags()}
          title="Top Tags"
        >#</div>
      </div>

      {/* BROWSE SECTION */}
      {sidebarPrimaryView === 'browse' && (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span className="sidebar-label">Browse</span>
          </div>
          <div className="sidebar-section-body">
            <div className={`sidebar-item ${isActive('all', null) ? 'active' : ''}`} onClick={() => handleFilterClick('all', null)}>
              <span className="item-icon">🗂</span>
              <span className="item-name">All Bookmarks</span>
              <span className="item-count">{bookmarks.length}</span>
            </div>
            <div className={`sidebar-item ${isActive('archived', true) ? 'active' : ''}`} onClick={() => handleFilterClick('archived', true)}>
              <span className="item-icon">📦</span>
              <span className="item-name">Archived</span>
              <span className="item-count">{bookmarks.filter(b => b.archived).length}</span>
            </div>
            <div className={`sidebar-item ${isActive('screenshot', true) ? 'active' : ''}`} onClick={() => handleFilterClick('screenshot', true)}>
              <span className="item-icon">📸</span>
              <span className="item-name">With Screenshot</span>
              <span className="item-count">{bookmarks.filter(b => b.screenshot).length}</span>
            </div>
          </div>
        </div>
      )}

      {/* VAULTS SECTION */}
      {/* VAULTS SECTION */}
{sidebarPrimaryView === 'vaults' && (
  <div className="sidebar-section">
    <div className="sidebar-section-header">
      <span className="sidebar-label">Vaults</span>
    </div>
    <div className="sidebar-section-body">
      {vaults.length === 0 ? <div className="sidebar-empty">No vaults yet</div> : null}
      {vaults.map(v => {
        const unlocked = !v.has_pin || isVaultUnlocked(v.name);
        return (
          <div
            key={v.name}
            className={`sidebar-item ${isActive('vault', v.name) ? 'active' : ''}`}
            /* FIX: Handled click directly on the container item so padding is reactive */
            onClick={() => {
              if (!unlocked) {
                setUnlockTarget(v.name);
              } else {
                handleFilterClick('vault', v.name);
              }
            }}
          >
            {/* Cleaned up this container span's wrapper properties */}
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="item-icon">🏦</span>
              <span className="item-name">{v.name}</span>
              <span className="item-count">{v.count}</span>
            </span>
            
            {v.has_pin && (
              <span
                style={{ cursor: 'pointer', padding: '0 4px', fontSize: 14 }}
                title={unlocked ? 'Lock vault' : 'Vault locked'}
                onClick={(e) => {
                  /* Stops the click from bubbling up to the filter action above */
                  e.stopPropagation();
                  if (unlocked) lockVault(v.name);
                  else setUnlockTarget(v.name);
                }}
              >
                {unlocked ? '🔓' : '🔒'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  </div>
)}

      {/* FOLDERS SECTION */}
      {sidebarPrimaryView === 'folders' && (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span className="sidebar-label">Folders</span>
          </div>
          <div className="sidebar-section-body">
            {folders?.length === 0 ? (
              <div className="sidebar-empty">No folders yet</div>
            ) : (
              <FolderTree parentId={null} depth={0} />
            )}
          </div>
        </div>
      )}

      {/* TAGS SECTION */}
      {sidebarTagsView && (
        <>
          <div className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="sidebar-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="sidebar-label">Tags</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {activeTagFilters.tags.length > 0 && (
                  <>
                    <button
                      onClick={() => setTagFilterMode(activeTagFilters.mode === 'and' ? 'or' : 'and')}
                      style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}
                    >
                      {activeTagFilters.mode.toUpperCase()}
                    </button>
                    <button
                      onClick={clearTagFilters}
                      style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}
                    >✕</button>
                  </>
                )}
              </div>
            </div>
            <div className="sidebar-section-body">
              {scopedTags.length === 0
                ? <div className="sidebar-empty">No tags in scope</div>
                : scopedTags.map(([tag, count]) => {
                  const isActive = activeTagFilters.tags.includes(tag);
                  return (
                    <div
                      key={tag}
                      className={`sidebar-item ${isActive ? 'active' : ''}`}
                      onClick={() => toggleTagFilter(tag)}
                    >
                      <span className="item-icon">#</span>
                      <span className="item-name">{tag}</span>
                      <span className="item-count">{count}</span>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </>
      )}


      {/* TOOLS SECTION (Always visible at the bottom) */}
      <div className="sidebar-divider"></div>
      {/* <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span className="sidebar-label">Tools</span>
        </div>
        <div className="sidebar-section-body">
          <div 
            className={`sidebar-item ${location.pathname === '/importer' ? 'active' : ''}`}
            onClick={() => navigate('/importer')}
          >
            <span className="item-icon">📥</span>
            <span className="item-name">Bulk Importer</span>
          </div>
          <div 
            className={`sidebar-item ${location.pathname === '/settings' ? 'active' : ''}`}
            onClick={() => navigate('/settings')}
          >
            <span className="item-icon">⚙️</span>
            <span className="item-name">Settings</span>
          </div>
        </div>
      </div> */}

    </aside>
  );
}