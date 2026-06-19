import { useState, useEffect } from 'react';
import { api, API_URL } from './api';
import { useCurrentTab } from './hooks/useCurrentTab';
import SaveTab from './components/SaveTab';
import ExplorerTab from './components/ExplorerTab';
import SaveAllModal from './components/SaveAllModal';

export default function App() {
    const [activeTab, setActiveTab] = useState('save');
    const [offline, setOffline] = useState(false);
    const [vaults, setVaults] = useState([]);
    const [selectedVault, setSelectedVault] = useState('default');
    const currentTab = useCurrentTab();
    const [saveAllModalTabs, setSaveAllModalTabs] = useState(null); // null = closed

    useEffect(() => {
        api.getHealth().catch(() => setOffline(true));
        api.getVaults().then(data => {
            setVaults(data.vaults || []);
            const stored = localStorage.getItem('pb_default_vault') || 'default';
            setSelectedVault(stored);
        }).catch(() => { });
    }, []);

    async function handleSaveAllTabs() {
        if (!currentTab) return;

        // Step 1 — query tabs
        const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
        const validTabs = allTabs.filter(t =>
            t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('about:')
        );

        // Step 2 — pre-scan for duplicates
        const scanned = await Promise.all(validTabs.map(async tab => {
            try {
                const data = await api.lookupUrl(tab.url);
                return {
                    ...tab,
                    exists: data.exists,
                    bookmarkId: data.bookmark_id || null,
                };
            } catch {
                return { ...tab, exists: false, bookmarkId: null };
            }
        }));

        // Step 3 — show modal
        setSaveAllModalTabs(scanned);
    }

    async function handleSaveAllConfirm(mode) {
        const tabs = mode === 'new-only'
            ? saveAllModalTabs.filter(t => !t.exists)
            : saveAllModalTabs;

        setSaveAllModalTabs(null);

        const captureScreenshots = localStorage.getItem('pb_save_all_tabs_screenshot') !== 'false';

        const res = await chrome.runtime.sendMessage({
            type: 'SAVE_ALL_TABS',
            windowId: currentTab.windowId,
            originalTabId: currentTab.id,
            vault: selectedVault,
            folder_id: null,
            tags: [],
            captureScreenshots,
            tabIds: tabs.map(t => t.id), // only send selected tabs
        });

        if (res.success) {
            const failed = res.results.filter(r => !r.success).length;
            const saved = res.results.filter(r => r.success).length;
            const t = document.getElementById('toast');
            t.textContent = `✓ Saved ${saved} tabs${failed ? `, ${failed} failed` : ''}`;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }
    }



    return (
        <div style={{ width: 520 }}>
            {offline && (
                <div className="offline-banner show">
                    ⚠ powerbookmarkd not running — start it first
                </div>
            )}

            <div className="header">
                <span className="logo">🔖</span>
                <span className="header-title">PowerBookmark</span>
                <button className="dashboard-link" onClick={() =>
                    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })
                }>
                    ⊞ Dashboard
                </button>
                <button className="dashboard-link" onClick={handleSaveAllTabs}>
                    📑 Save All Tabs
                </button>
            </div>

            <div className="tabs">
                {['save', 'explorer'].map(t => (
                    <div
                        key={t}
                        className={`tab ${activeTab === t ? 'active' : ''}`}
                        onClick={() => setActiveTab(t)}
                    >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </div>
                ))}
            </div>

            {saveAllModalTabs && (
    <SaveAllModal
        tabs={saveAllModalTabs}
        onConfirm={handleSaveAllConfirm}
        onCancel={() => setSaveAllModalTabs(null)}
    />
)}

            {activeTab === 'save' && (
                <SaveTab
                    currentTab={currentTab}
                    vaults={vaults}
                    selectedVault={selectedVault}
                    setSelectedVault={setSelectedVault}
                    offline={offline}
                />
            )}
            {activeTab === 'explorer' && (
                <ExplorerTab
                    selectedVault={selectedVault}
                />
            )}

            <div className="toast" id="toast" />
        </div>
    );
}