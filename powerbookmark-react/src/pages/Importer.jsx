// src/pages/Importer.jsx
export default function Importer() {
  return (
    <main className="main">
      <div className="main-header">
        <div className="main-title">Bulk Importer</div>
        <div className="main-subtitle">Import from Chrome JSON/HTML</div>
      </div>
      <div className="empty-state">
        <div className="empty-icon">📥</div>
        <div className="empty-title">Importer Construction Zone</div>
        <div className="empty-sub">We will build the recursive JSON parser here next!</div>
      </div>
    </main>
  );
}