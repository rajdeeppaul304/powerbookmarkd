import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import JobCard from './JobCard'; // Actually importing the modular component!

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

          <div className="job-widget-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)', fontSize: '13px' }}>
                No active jobs.
              </div>
            ) : (
              jobs.map(job => (
                <JobCard 
                  key={job.id} 
                  job={job} 
                  onControl={controlJob} 
                />
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