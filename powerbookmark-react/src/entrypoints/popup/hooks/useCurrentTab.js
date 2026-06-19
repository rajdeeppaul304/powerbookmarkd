import { useState, useEffect } from 'react';

export function useCurrentTab() {
    const [tab, setTab] = useState(null);

    useEffect(() => {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t));
    }, []);

    return tab;
}