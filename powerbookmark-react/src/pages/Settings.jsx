// src/pages/Settings.jsx
export default function Settings() {
  return (
    <main className="main">
      <div className="main-header">
        <div className="main-title">Settings</div>
        <div className="main-subtitle">Preferences and Vault configuration</div>
      </div>
      <div className="empty-state">
        <div className="empty-icon">⚙️</div>
        <div className="empty-title">Settings Configuration</div>
        <div className="empty-sub">Default vaults and UI preferences will live here.</div>
      </div>
    </main>
  );
}