import { useStore } from '../store';

export default function Topbar() {
  const { bookmarks, viewMode, setViewMode, setSearchQuery } = useStore();

  return (
    <header className="topbar">
      <div className="logo">
        <span className="logo-icon">🔖</span>
        PowerBookmark
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