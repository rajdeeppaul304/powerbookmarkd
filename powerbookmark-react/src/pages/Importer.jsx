import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { parseBookmarksHtml } from '../utils/bookmarkParser';
import JobCard from '../components/JobCard';

function hostUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function applyToSubtree(node, fn) {
  fn(node);
  if (node.children) node.children.forEach(c => applyToSubtree(c, fn));
}

// --- TREE NODE ---
const TreeNode = ({ node, checkedState, archiveState, expandedState, onToggle, onArchiveToggle, onExpandToggle, depth = 0 }) => {
  const isChecked  = checkedState[node.id]  || false;
  const isArchived = archiveState[node.id]  || false;
  const isExpanded = expandedState[node.id] !== false;
  const isFolder   = node.type === 'folder';

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div
        className={`node-row${isChecked ? '' : ' unchecked'}`}
        onClick={isFolder ? () => onExpandToggle(node.id) : undefined}
        style={{
          display: 'grid', gridTemplateColumns: '1fr 80px', alignItems: 'center',
          padding: '8px 14px', gap: 8, paddingLeft: 14 + depth * 20,
          transition: 'background .1s', cursor: isFolder ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={e => onToggle(node, e.target.checked)}
            onClick={e => e.stopPropagation()}
            style={{ width: 14, height: 14, flexShrink: 0, accentColor: 'var(--text)', cursor: 'pointer' }}
          />
          {isFolder
            ? <span style={{ fontSize: 13, color: 'var(--text3)', flexShrink: 0 }}>{isExpanded ? '📂' : '📁'}</span>
            : <img
                src={`https://www.google.com/s2/favicons?sz=16&domain=${(() => { try { return new URL(node.url).hostname; } catch { return ''; } })()}`}
                width={14} height={14}
                style={{ flexShrink: 0, borderRadius: 2 }}
                onError={e => { e.target.style.display = 'none'; }}
                alt=""
              />
          }
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isChecked ? 1 : 0.4 }} title={node.name || node.title}>
              {node.name || node.title || 'Untitled'}
            </div>
            {!isFolder && node.url && (
              <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isChecked ? 1 : 0.35 }}>
                <a href={node.url} target="_blank" rel="noopener noreferrer" title={node.url}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  onClick={e => e.stopPropagation()}
                >
                  {hostUrl(node.url)} ↗
                </a>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={isArchived}
            disabled={!isChecked}
            onChange={e => onArchiveToggle(node, e.target.checked)}
            onClick={e => e.stopPropagation()}
            title={isChecked ? 'Archive after import' : 'Select to enable archiving'}
            style={{ width: 13, height: 13, accentColor: 'var(--text)', cursor: isChecked ? 'pointer' : 'not-allowed', opacity: isChecked ? 1 : 0.3 }}
          />
        </div>
      </div>

      {isFolder && node.children?.length > 0 && isExpanded && (
        <div style={{ borderTop: '0.5px solid var(--border)' }}>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              checkedState={checkedState}
              archiveState={archiveState}
              expandedState={expandedState}
              onToggle={onToggle}
              onArchiveToggle={onArchiveToggle}
              onExpandToggle={onExpandToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- MAIN PAGE ---
export default function Importer() {
  const { vaults, loadInitialData, jobs, controlJob, fetchJobsStatus } = useStore();

  const [parsedTree,   setParsedTree]   = useState([]);
  const [checkedState, setCheckedState] = useState({});
  const [archiveState, setArchiveState] = useState({});
  const [expandedState,setExpandedState]= useState({});
  const [targetVault,  setTargetVault]  = useState(vaults[0]?.name || 'default');
  const [isParsing,    setIsParsing]    = useState(false);
  const [isImporting,  setIsImporting]  = useState(false);
  const [isDragging,   setIsDragging]   = useState(false);

  // --- Identify if we have background import jobs ---
  const importJobs = jobs.filter(j => j.type.includes('Bulk Import'));
  const hasActiveImport = importJobs.length > 0;

  // --- Helpers ---
  const initState = (nodes) => {
    const ch = {}, ar = {}, ex = {};
    const walk = (list) => {
      for (const n of list) {
        ch[n.id] = true;
        ar[n.id] = false;
        ex[n.id] = true;
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return { ch, ar, ex };
  };

  const handleFile = async (file) => {
    if (!file) return;
    setIsParsing(true);
    try {
      const tree = await parseBookmarksHtml(file);
      const { ch, ar, ex } = initState(tree);
      setParsedTree(tree);
      setCheckedState(ch);
      setArchiveState(ar);
      setExpandedState(ex);
    } catch (err) {
      alert('Failed to parse file: ' + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileInput = async (e) => {
    await handleFile(e.target.files[0]);
    e.target.value = null;
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFile(e.dataTransfer.files[0]);
  };

  // --- Toggle handlers ---
  const handleToggle = (node, isChecked) => {
    setCheckedState(prev => {
      const next = { ...prev };
      applyToSubtree(node, n => { next[n.id] = isChecked; });
      return next;
    });
    if (!isChecked) {
      setArchiveState(prev => {
        const next = { ...prev };
        applyToSubtree(node, n => { next[n.id] = false; });
        return next;
      });
    }
  };

  const handleArchiveToggle = (node, isChecked) => {
    setArchiveState(prev => {
      const next = { ...prev };
      applyToSubtree(node, n => { if (checkedState[n.id]) next[n.id] = isChecked; });
      return next;
    });
  };

  const handleExpandToggle = (id) => {
    setExpandedState(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // --- Import ---
  const handleImport = async () => {
    setIsImporting(true);
    const flatList = [];

    const flatten = (nodes, parentId = null) => {
      for (const node of nodes) {
        if (!checkedState[node.id]) continue;
        if (node.type === 'folder') {
          flatList.push({ type: 'folder', id: node.id, parent_id: parentId, name: node.name });
          flatten(node.children || [], node.id);
        } else {
          flatList.push({ type: 'bookmark', url: node.url, title: node.title, folder_id: parentId, add_date: node.addDate || null, archive: archiveState[node.id] || false });
        }
      }
    };

    flatten(parsedTree, null);

    if (flatList.length === 0) {
      alert("Nothing selected to import.");
      setIsImporting(false);
      return;
    }

    try {
      await api.bulkImport({ vault: targetVault, items: flatList });
      
      // Force an immediate sync so the job screen triggers instantly
      await fetchJobsStatus(); 
      loadInitialData();
      
      setParsedTree([]); // Clear staging
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const selectedCount = Object.values(checkedState).filter(Boolean).length;
  const archivedCount = Object.values(archiveState).filter(Boolean).length;


  // =========================================================================
  // VIEW 1: ACTIVE IMPORT PROGRESS SCREEN
  // =========================================================================
if (hasActiveImport) {
    const isAllComplete = importJobs.every(j => ['completed', 'canceled', 'error'].includes(j.status));

    return (
      <main className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="main-header" style={{ flexShrink: 0, borderBottom: '0.5px solid var(--border)', paddingBottom: 16 }}>
          <div className="main-title">Import in Progress</div>
          <div className="main-subtitle">
            {isAllComplete 
              ? "All import tasks have concluded. You can review the details or dismiss them." 
              : "We are actively fetching data for your imported bookmarks. Please wait."}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%', maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {importJobs.map(job => (
              <JobCard 
                key={job.id} 
                job={job} 
                onControl={controlJob} 
              />
            ))}

            {isAllComplete && (
               <button 
                  className="btn btn-primary" 
                  style={{ alignSelf: 'flex-end', marginTop: 8 }}
                  onClick={() => importJobs.forEach(j => controlJob(j.id, 'dismiss'))}
                >
                 Dismiss All & Start New Import
               </button>
            )}
          </div>
        </div>
      </main>
          );
  }

  // =========================================================================
  // VIEW 2: UPLOAD SCREEN (Only visible if NO background imports are active)
  // =========================================================================
  if (parsedTree.length === 0) {
    return (
      <main className="main" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="main-header" style={{ flexShrink: 0 }}>
          <div className="main-title">Bulk importer</div>
          <div className="main-subtitle">Upload a Chrome or Firefox .html bookmarks export</div>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <label
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              border: `0.5px dashed var(--border${isDragging ? '' : '2'})`,
              borderRadius: 12, padding: '3rem 2rem', cursor: 'pointer', width: '100%', maxWidth: 420,
              background: isDragging ? 'var(--bg2)' : 'transparent', transition: 'background .15s, border-color .15s',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>📥</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
              {isParsing ? 'Parsing…' : 'Drop your bookmarks file here'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
              Or click to select a .html export from Chrome or Firefox
            </div>
            <span className="btn btn-primary" style={{ pointerEvents: 'none' }}>
              Choose file
            </span>
            <input type="file" accept=".html" onChange={handleFileInput} style={{ display: 'none' }} />
          </label>
        </div>
      </main>
    );
  }

  // =========================================================================
  // VIEW 3: STAGING SCREEN
  // =========================================================================
  return (
    <main className="main" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
        borderBottom: '0.5px solid var(--border)', flexShrink: 0, flexWrap: 'wrap',
        background: 'var(--bg2)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>Staging area</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, display: 'flex', gap: 8 }}>
            <span>{selectedCount} item{selectedCount !== 1 ? 's' : ''} selected</span>
            {archivedCount > 0 && <span>· {archivedCount} to archive</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>Vault</span>
          <select
            className="tag-input"
            value={targetVault}
            onChange={e => setTargetVault(e.target.value)}
            style={{ margin: 0, width: 140, fontSize: 13 }}
          >
            {vaults.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={() => setParsedTree([])}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={isImporting || selectedCount === 0}>
            {isImporting ? 'Starting Jobs…' : `Import ${selectedCount}`}
          </button>
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px',
            padding: '8px 14px', background: 'var(--bg2)',
            borderBottom: '0.5px solid var(--border)',
          }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Name</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'center' }}>Archive</span>
          </div>

          {parsedTree.map(node => (
            <TreeNode
              key={node.id}
              node={node}
              checkedState={checkedState}
              archiveState={archiveState}
              expandedState={expandedState}
              onToggle={handleToggle}
              onArchiveToggle={handleArchiveToggle}
              onExpandToggle={handleExpandToggle}
            />
          ))}
        </div>
      </div>
    </main>
  );
}