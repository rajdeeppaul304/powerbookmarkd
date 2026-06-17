import { useStore } from '../store';

export default function BulkBar() {
    const { 
        selectedBookmarks, 
        selectedFolders, 
        clearSelection, 
        setTargetFetchIds, 
        setBulkFetchOpen,
        setMassCopyOpen,
        setMassTaggerOpen,
        requestDeletion, // <--- Swap this in
        setMassMoveOpen,
            undoStack, redoStack,
    undo, redo

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
                onClick={() => setMassMoveOpen(true)}
            >
                ✦ Move
            </button>
            
            <button 
                className="bulk-btn green" 
                style={{ opacity: bmCount ? 1 : 0.4, pointerEvents: bmCount ? 'auto' : 'none' }}
                onClick={() => setMassCopyOpen(true)}
            >
                ⧉ Copy
            </button>

<button
    className="bulk-btn"
    style={{ opacity: undoStack.length ? 1 : 0.4, pointerEvents: undoStack.length ? 'auto' : 'none' }}
    onClick={undo}
>
    ↩ Undo
</button>

<button
    className="bulk-btn"
    style={{ opacity: redoStack.length ? 1 : 0.4, pointerEvents: redoStack.length ? 'auto' : 'none' }}
    onClick={redo}
>
    ↪ Redo
</button>

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
                    setTargetFetchIds(Array.from(selectedBookmarks));
                    setBulkFetchOpen(true);
                }}
            >⚡ Fetch</button>
            
            {/* --- WIRE THE NEW FUNNEL HERE --- */}
            <button 
                className="bulk-btn red" 
                onClick={() => requestDeletion({ 
                    bookmarkIds: Array.from(selectedBookmarks), 
                    folderIds: Array.from(selectedFolders) 
                })}
            >
                🗑 Delete
            </button>
            
            <button className="bulk-btn desel" onClick={clearSelection}>✕ Deselect</button>
        </div>
    );
}