import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';




export default function Settings() {
  const { vaults, loadInitialData, defaultVault, setDefaultVault, viewMode, setViewMode, vaultLockTimeout, setVaultLockTimeout } = useStore();
  const [newVaultName, setNewVaultName] = useState("");
  const saveAllTabsScreenshot = localStorage.getItem('pb_save_all_tabs_screenshot') !== 'false';
const [tabScreenshotMode, setTabScreenshotMode] = useState(saveAllTabsScreenshot);

const handleTabScreenshotMode = (val) => {
    localStorage.setItem('pb_save_all_tabs_screenshot', val);
    setTabScreenshotMode(val);
};


  const handleCreateVault = async () => {
    if (!newVaultName.trim()) return;
    await api.createVault(newVaultName.trim());
    setNewVaultName("");
    loadInitialData();
  };


  const handleRenameVault = async (oldName) => {
    const newName = window.prompt(`Rename vault "${oldName}" to:`, oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;

    try {
      await api.renameVault(oldName, newName.trim());

      // If we just renamed our Default Vault, we need to update our localStorage!
      if (oldName === defaultVault) {
        setDefaultVault(newName.trim());
      }

      loadInitialData(); // Refresh everything
    } catch (err) {
      alert("Failed to rename vault: " + err.message);
    }
  };

  const handleSetPin = async (vaultName, hasPin) => {
    const pin = window.prompt(hasPin ? "Enter new PIN (leave blank to remove):" : "Set a PIN for this vault:");
    if (pin === null) return; // cancelled
    await api.setVaultPin(vaultName, pin.trim() === '' ? null : pin.trim());
    loadInitialData();
  };

  const handleDeleteVault = async (name) => {
    // Safety check!
    if (name === defaultVault) {
      alert("You cannot delete your current Default Vault. Please change it to something else first.");
      return;
    }

    if (window.confirm(`Delete vault "${name}"? All items inside will be permanently lost!`)) {
      await api.deleteVault(name);
      loadInitialData();
    }
  };

  return (
    <main className="main" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '32px' }}>Settings</h1>

      {/* GENERAL PREFERENCES */}
      <section style={{ marginBottom: '32px', background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '24px' }}>General Preferences</h3>

        <div className="detail-field">
          <div className="detail-field-label">Default Vault</div>
          <select
            className="tag-input"
            style={{ maxWidth: '300px', cursor: 'pointer' }}
            value={defaultVault}
            onChange={e => setDefaultVault(e.target.value)}
          >
            {vaults.map(v => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '8px', lineHeight: '1.4' }}>
            This sets the default destination for new bookmarks. <br />
            <i>Beware: This makes this vault default for your browser (across incognito), but only in this specific Chrome profile.</i>
          </p>
        </div>

        <div className="detail-field" style={{ marginTop: '24px' }}>
          <div className="detail-field-label">Default View Mode</div>
          <select
            className="tag-input"
            style={{ maxWidth: '300px', cursor: 'pointer' }}
            value={viewMode}
            onChange={e => setViewMode(e.target.value)}
          >
            <option value="grid">Grid View ⊞</option>
            <option value="list">List View ☰</option>
          </select>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '8px' }}>
            Choose how bookmarks are displayed on the dashboard when you open the app.
          </p>
        </div>

        <div className="detail-field" style={{ marginTop: '24px' }}>
          <div className="detail-field-label">Vault Auto-Lock Timeout</div>
          <select
            className="tag-input"
            style={{ maxWidth: '300px', cursor: 'pointer' }}
            value={vaultLockTimeout}
            onChange={e => setVaultLockTimeout(Number(e.target.value))}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={240}>4 hours</option>
            <option value={1440}>1 day</option>
            <option value={10080}>7 days</option>
          </select>
        </div>

        <div className="detail-field" style={{ marginTop: '24px' }}>
    <div className="detail-field-label">Save All Tabs — Screenshot Mode</div>
    <select
        className="tag-input"
        style={{ maxWidth: '300px', cursor: 'pointer' }}
        value={tabScreenshotMode ? 'flash' : 'none'}
        onChange={e => handleTabScreenshotMode(e.target.value === 'flash')}
    >
        <option value="flash">📸 Flash tabs (real screenshots)</option>
        <option value="none">⚡ No screenshot (instant)</option>
    </select>
    <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '8px', lineHeight: '1.4' }}>
        Flash tabs switches to each tab briefly to capture a screenshot. 
        Visually jarring but captures logged-in content accurately.
    </p>
</div>
      </section>

      {/* MANAGE VAULTS */}


      <section style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '24px' }}>Manage Vaults</h3>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <input
            className="tag-input"
            placeholder="New Vault Name"
            value={newVaultName}
            onChange={e => setNewVaultName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateVault()}
            style={{ maxWidth: '300px' }}
          />
          <button className="btn btn-primary" onClick={handleCreateVault}>Create Vault</button>
        </div>

        <div className="settings-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {vaults.map(v => (
            <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '18px' }}>🏦</span>
                <span style={{ fontWeight: 600 }}>{v.name}</span>
                <span style={{ color: 'var(--text3)', fontSize: '14px' }}>({v.count} items)</span>
                {v.name === defaultVault && <span style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--blue)', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>DEFAULT</span>}
              </div>
              <button
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px', marginRight: '8px' }}
                onClick={() => handleSetPin(v.name, v.has_pin)}
              >
                {v.has_pin ? '🔒 Change PIN' : '🔒 Set PIN'}
              </button>
              {v.name !== 'default' && (
                <div>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', marginRight: '8px' }}
                    onClick={() => handleRenameVault(v.name)}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-danger-outline"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    onClick={() => handleDeleteVault(v.name)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

    </main>
  );
}