import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function Settings() {
  const { vaults, loadInitialData, defaultVault, setDefaultVault, viewMode, setViewMode } = useStore();
  const [newVaultName, setNewVaultName] = useState("");

  const handleCreateVault = async () => {
    if (!newVaultName.trim()) return;
    await api.createVault(newVaultName.trim());
    setNewVaultName("");
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
            This sets the default destination for new bookmarks. <br/>
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
              
              {v.name !== 'default' && (
                <button 
                  className="btn btn-danger-outline" 
                  style={{ padding: '6px 12px', fontSize: '12px' }} 
                  onClick={() => handleDeleteVault(v.name)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

    </main>
  );
}