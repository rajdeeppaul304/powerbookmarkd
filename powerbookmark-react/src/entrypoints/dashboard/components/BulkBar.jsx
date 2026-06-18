import { useState, useEffect, useRef } from 'react';
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
        requestDeletion,
        setMassMoveOpen,
        undoStack, redoStack,
        undo, redo,
        openSelection,
    } = useStore();

    const [openMenuVisible, setOpenMenuVisible] = useState(false);
    const menuRef = useRef(null); // Ref to track the dropdown menu container

    const bmCount = selectedBookmarks.size;
    const folCount = selectedFolders.size;
    const total = bmCount + folCount;

    // Fix 1: Automatically close the dropdown menu if the BulkBar hides (total drops to 0)
    useEffect(() => {
        if (total === 0) {
            setOpenMenuVisible(false);
        }
    }, [total]);

    // Fix 2: Close the menu when clicking anywhere outside of the menu container
    useEffect(() => {
        function handleClickOutside(event) {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setOpenMenuVisible(false);
            }
        }

        if (openMenuVisible) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [openMenuVisible]);

    let label = `${total} selected`;
    if (bmCount && folCount) label = `${bmCount} bookmark${bmCount > 1 ? 's' : ''} + ${folCount} folder${folCount > 1 ? 's' : ''}`;
    else if (folCount) label = `${folCount} folder${folCount > 1 ? 's' : ''}`;

    const handleOpen = (action) => {
        setOpenMenuVisible(false);
        openSelection(action);
    };

    return (
        <div className={`bulk-bar ${total > 0 ? 'visible' : ''}`}>
            <span className="bulk-count">{label}</span>

            {/* Attached the ref to this wrapper wrapper so clicking the button or dropdown keeps it open */}
            <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
                <button
                    className="bulk-btn"
                    onClick={() => setOpenMenuVisible(v => !v)}
                >
                    ↗ Open
                </button>

                {openMenuVisible && (
                    <div
                        style={{
                            position: 'absolute',
                            bottom: '110%',
                            left: 0,
                            zIndex: 999,
                            background: '#1f1f1f',
                            border: '1px solid #333',
                            borderRadius: 8,
                            padding: 4,
                            minWidth: 200,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <button className="bulk-menu-item" onClick={() => handleOpen('current')}>
                            Open all
                        </button>
                        <button className="bulk-menu-item" onClick={() => handleOpen('newWindow')}>
                            Open all in new window
                        </button>
                        <button className="bulk-menu-item" onClick={() => handleOpen('incognito')}>
                            Open all in new private window
                        </button>
                        <button className="bulk-menu-item" onClick={() => handleOpen('tabGroup')}>
                            Open all in new tab group
                        </button>
                    </div>
                )}
            </div>

            <button className="bulk-btn blue" onClick={() => setMassMoveOpen(true)}>
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