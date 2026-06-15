import { useState } from 'react';

export default function JobCard({ job, onControl }) {
  const [showDetails, setShowDetails] = useState(false);

  const errors = job.errors || [];
  const successCount = job.success_count || 0;
  const isFinished = ['completed', 'canceled', 'error'].includes(job.status);
  
  const statusColor = 
    job.status === 'completed' ? 'var(--green)' : 
    job.status === 'error' ? 'var(--red)' : 
    job.status === 'canceled' ? 'var(--text3)' : 'var(--blue)';

  return (
    <div style={{ 
      border: '1px solid var(--border)', borderRadius: 12, padding: 20, 
      background: 'var(--bg2)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
      width: '100%', display: 'flex', flexDirection: 'column', gap: 12
    }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 15, color: 'var(--text)' }}>{job.type}</strong>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', color: statusColor }}>
          {job.status.toUpperCase()}
        </span>
      </div>
      
      {/* Progress Bar */}
      <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ 
            height: '100%',
            width: `${job.total > 0 ? (job.current / job.total) * 100 : 0}%`, 
            background: statusColor,
            transition: 'width 0.3s ease, background 0.3s ease'
          }}
        />
      </div>
      
      {/* Status & Basic Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>
            {job.current} / {job.total} processed
          </span>
          {isFinished && (
            <button 
              onClick={() => setShowDetails(!showDetails)}
              style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', padding: 0 }}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          {job.status === 'running' && (
            <button className="btn btn-secondary" onClick={() => onControl(job.id, 'pause')}>Pause</button>
          )}
          {job.status === 'paused' && (
            <button className="btn btn-primary" onClick={() => onControl(job.id, 'resume')}>Resume</button>
          )}
          {(job.status === 'running' || job.status === 'paused') && (
            <button className="btn btn-danger-outline" onClick={() => onControl(job.id, 'cancel')}>Cancel</button>
          )}
          {isFinished && (
            <button className="btn btn-secondary" onClick={() => onControl(job.id, 'dismiss')}>Dismiss</button>
          )}
        </div>
      </div>

      {/* Accordion Details */}
      {showDetails && (
        <div style={{ 
          marginTop: 8, paddingTop: 12, borderTop: '0.5px solid var(--border)', 
          fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8
        }}>
          <div style={{ color: 'var(--green)', fontWeight: 500 }}>
            ✅ Successfully processed: {successCount}
          </div>
          
          {errors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ color: 'var(--red)', fontWeight: 500, marginBottom: 4 }}>
                ❌ Failed items ({errors.length}):
              </div>
              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                {errors.map((err, i) => (
                  <div key={i} style={{ background: 'var(--bg3)', padding: 8, borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {err.url}
                    </div>
                    <div style={{ color: 'var(--text3)' }}>
                      <span style={{ background: 'var(--border)', padding: '2px 6px', borderRadius: 4, marginRight: 6, fontSize: 10, textTransform: 'uppercase' }}>
                        {err.phase}
                      </span>
                      {err.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}