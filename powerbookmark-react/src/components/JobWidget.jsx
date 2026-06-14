import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

export default function JobWidget() {
  const { jobs, controlJob } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef(null);

  // Close when clicking outside the panel
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // NOTE: Commented this out so you can see the widget while testing! 
  // Once it works perfectly, uncomment this so it hides when empty.
  // if (jobs.length === 0) return null;

  const runningJobs = jobs.filter(j => j.status === 'running').length;
  // If there are jobs, and none are running/paused, then it's all complete.
  const isAllComplete = jobs.length > 0 && jobs.every(j => j.status === 'completed' || j.status === 'canceled' || j.status === 'error');

  return (
    <div className="job-widget-container">
      
      {/* THE CHAT PANEL */}
      {isOpen && (
        <div className="job-widget-panel" ref={panelRef}>
          <div className="job-widget-header">
            <span>Background Jobs</span>
            <button className="job-widget-close" onClick={() => setIsOpen(false)}>✕</button>
          </div>

          <div className="job-widget-body">
            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)', fontSize: '13px' }}>
                No active jobs.
              </div>
            ) : (
              jobs.map(job => (
                <div key={job.id} className="job-item">
                  <div className="job-item-header">
                    <strong>{job.type}</strong>
                    <span style={{ 
                      color: job.status === 'completed' ? 'var(--green)' : 
                             job.status === 'error' ? 'var(--red)' : 
                             job.status === 'canceled' ? 'var(--text3)' : 'var(--blue)' 
                    }}>
                      {job.status.toUpperCase()}
                    </span>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="job-progress-bg">
                    <div 
                      className="job-progress-fill"
                      style={{ 
                        width: `${job.total > 0 ? (job.current / job.total) * 100 : 0}%`, 
                        background: job.status === 'completed' ? 'var(--green)' : 'var(--blue)'
                      }}
                    ></div>
                  </div>
                  
                  <div className="job-item-footer">
                    <span>{job.current} / {job.total} items</span>
                    
                    {/* Controls based on status */}
                    <div className="job-controls">
                      {job.status === 'running' && (
                        <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => controlJob(job.id, 'pause')}>Pause</button>
                      )}
                      {job.status === 'paused' && (
                        <button className="btn btn-primary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => controlJob(job.id, 'resume')}>Resume</button>
                      )}
                      {(job.status === 'running' || job.status === 'paused') && (
                        <button className="btn btn-danger-outline" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => controlJob(job.id, 'canceled')}>Stop</button>
                      )}
                      {(job.status === 'completed' || job.status === 'canceled' || job.status === 'error') && (
                        <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => controlJob(job.id, 'dismiss')}>Dismiss</button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* THE FLOATING BUTTON */}
      <button 
        className="job-fab"
        onClick={() => setIsOpen(!isOpen)}
        style={{ background: isAllComplete ? 'var(--green)' : 'var(--blue)' }}
      >
        {runningJobs > 0 ? '⏳' : (isAllComplete ? '✅' : '⚙️')}
        
        {runningJobs > 0 && (
          <span className="job-fab-badge">
            {runningJobs}
          </span>
        )}
      </button>
    </div>
  );
}