import { useStore } from '../store';

export default function BulkBar() {
    const { 
        selectedBookmarks, 
        selectedFolders, 
        clearSelection, 
        setTargetFetchIds, 
        setBulkFetchOpen,
        setMassCopyOpen,    // Hooking up the Copy state setter
        setMassTaggerOpen,  // Hooking up the Tag state setter
        executeBulkDelete,
        setMassMoveOpen
    } = useStore();

    const bmCount = selectedBookmarks.size;
    const folCount = selectedFolders.size;
    const total = bmCount + folCount;

    let label = `${total} selected`;
    if (bmCount && folCount) label = `${bmCount} bookmark${bmCount > 1 ? 's' : ''} + ${folCount} folder${folCount > 1 ? 's' : ''}`;
    else if (folCount) label = `${folCount} folder${folCount > 1 ? 's' : ''}`;

    return (
        <div className={`bulk-bar ${total > 0 ? 'visible' : ''}`}>
            <span className="bulk-count">{label}</span>
            <button 
                className="bulk-btn blue" 
                onClick={() => setMassMoveOpen(true)} // <--- WIRE THIS
            >
                ✦ Move
            </button>
            
            {/* 1. Wire up Mass Copy */}
            <button 
                className="bulk-btn green" 
                style={{ opacity: bmCount ? 1 : 0.4, pointerEvents: bmCount ? 'auto' : 'none' }}
                onClick={() => setMassCopyOpen(true)}
            >
                ⧉ Copy
            </button>

            {/* 2. Wire up Mass Tag */}
            <button
                className="bulk-btn"
                style={{ opacity: bmCount ? 1 : 0.4, pointerEvents: bmCount ? 'auto' : 'none' }}
                onClick={() => setMassTaggerOpen(true)}
            >
                🏷 Tag
            </button>

            <button
                className="bulk-btn"
                style={{ opacity: bmCount && !folCount ? 1 : 0.4, pointerEvents: bmCount && !folCount ? 'auto' : 'none' }}
                onClick={() => {
                    setTargetFetchIds(Array.from(selectedBookmarks)); // Send the selected IDs to the store
                    setBulkFetchOpen(true); // Open the modal
                }}
            >⚡ Fetch</button>
            <button className="bulk-btn red" onClick={executeBulkDelete}>🗑 Delete</button>
            <button className="bulk-btn desel" onClick={clearSelection}>✕ Deselect</button>
        </div>
    );
}