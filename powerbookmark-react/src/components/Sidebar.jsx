// src/components/Sidebar.jsx
import { useNavigate, useLocation } from 'react-router-dom'; // <--- Add this
import { useStore } from '../store';
import FolderTree from './FolderTree';


export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sidebarPrimaryView, setSidebarPrimaryView,
    sidebarTagsView, toggleSidebarTags,
    vaults, bookmarks, folders, currentFilter, setFilter,
    setNewFolderOpen, setNewBookmarkOpen // <--- ADD THESE TWO
  } = useStore();

  const handleFilterClick = (type, value) => {
    setFilter(type, value);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  // Calculate Top Tags dynamically from our bookmarks state
  const tagCounts = {};
  bookmarks.forEach(b => (b.tags || []).forEach(t => {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Helper to check if an item is currently selected
  const isActive = (type, value) => currentFilter.type === type && currentFilter.value === value;

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
      {sidebarPrimaryView === 'vaults' && (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span className="sidebar-label">Vaults</span>
          </div>
          <div className="sidebar-section-body">
            {vaults.length === 0 ? <div className="sidebar-empty">No vaults yet</div> : null}
            {vaults.map(v => (
              <div
                key={v.name}
                className={`sidebar-item ${isActive('vault', v.name) ? 'active' : ''}`}
                onClick={() => handleFilterClick('vault', v.name)}
              >
                <span className="item-icon">🏦</span>
                <span className="item-name">{v.name}</span>
                <span className="item-count">{v.count}</span>
              </div>
            ))}
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
          <div className="sidebar-divider"></div>
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-label">Top Tags</span>
            </div>
            <div className="sidebar-section-body">
              {topTags.length === 0 ? <div className="sidebar-empty">No tags yet</div> : null}
              {topTags.map(([tag, count]) => (
                <div
                  key={tag}
                  className={`sidebar-item ${isActive('tag', tag) ? 'active' : ''}`}
                  onClick={() => handleFilterClick('tag', tag)}
                >
                  <span className="item-icon">#</span>
                  <span className="item-name">{tag}</span>
                  <span className="item-count">{count}</span>
                </div>
              ))}
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