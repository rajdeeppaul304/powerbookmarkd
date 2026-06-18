import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';

export default function Topbar() {
  const { bookmarks, viewMode, setViewMode, setSearchQuery, lockAllVaults, vaults } = useStore();

  const navigate = useNavigate();
  const location = useLocation();
  const hasAnyLockedVault = vaults.some(v => v.has_pin);

  const isActive = (path) => location.pathname === path;

  return (
    <header className="topbar">
      <div
        className="logo"
        style={{ cursor: 'pointer', marginRight: '16px' }}
        onClick={() => navigate('/')}
      >
        <span className="logo-icon">🔖</span>
        PowerBookmark
      </div>

      {/* NEW APP NAVIGATION */}
      <div style={{ display: 'flex', gap: '8px', marginRight: 'auto' }}>
        <button
          className={`btn ${isActive('/') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px' }}
          onClick={() => navigate('/')}
        >Dashboard</button>
        <button
          className={`btn ${isActive('/importer') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px' }}
          onClick={() => navigate('/importer')}
        >Importer</button>
        <button
          className={`btn ${isActive('/settings') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px' }}
          onClick={() => navigate('/settings')}
        >Settings</button>
        <button
          className={`btn ${isActive('/trash') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px' }}
          onClick={() => navigate('/trash')}
        >🗑 Trash</button>
        {hasAnyLockedVault && (
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 12px' }}
            onClick={lockAllVaults}
            title="Lock all vaults"
          >
            🔒 Lock All
          </button>
        )}
      </div>

      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="Search titles, URLs, notes…"
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="topbar-right">
        <div className="stat-pill"><span>{bookmarks.length}</span> bookmarks</div>
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >⊞</button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >☰</button>
        </div>
      </div>
    </header>
  );
}