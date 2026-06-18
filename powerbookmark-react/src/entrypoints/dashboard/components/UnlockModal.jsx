import { useState } from 'react';
import { useStore } from '../store';

export default function UnlockModal() {
    const { unlockTarget, setUnlockTarget, unlockVault, setFilter } = useStore();
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (!unlockTarget) return null;

    const closeModal = () => {
        setUnlockTarget(null);
        setPin('');
        setError('');
    };

    const handleUnlock = async () => {
        if (!pin.trim()) return;
        setLoading(true);
        setError('');
        try {
            await unlockVault(unlockTarget, pin.trim());
            setFilter('vault', unlockTarget);
            closeModal();
        } catch (err) {
            setError('Incorrect PIN. Try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        /* Added 'open' class to match index.css overlay requirements */
        <div className="modal-overlay open" onClick={closeModal}>
            {/* Swapped 'modal' with 'modal-box' & adjusted width to be a standard 400px maximum */}
            <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
                
                <div className="modal-header">
                    {/* Replaced with structured 'modal-title' and matching close button markup */}
                    <div className="modal-title">
                        <span style={{ marginRight: 6 }}>🔒</span> Unlock "{unlockTarget}"
                    </div>
                    <button className="modal-close-btn" onClick={closeModal}>✕</button>
                </div>
                
                {/* Standardized padding, structured label/input within 'detail-field' wrapper */}
                <div className="modal-body" style={{ padding: '16px 18px' }}>
                    <div className="detail-field">
                        <div className="detail-field-label">Vault PIN</div>
                        <input
                            type="password"
                            className="tag-input"
                            placeholder="Enter PIN"
                            value={pin}
                            autoFocus
                            onChange={e => { setPin(e.target.value); setError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                        />
                    </div>
                    {/* Cleaned up error placement to match the clean field layout spacing */}
                    {error && (
                        <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>
                            {error}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={closeModal}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleUnlock} disabled={loading || !pin.trim()}>
                        {loading ? 'Checking…' : 'Unlock'}
                    </button>
                </div>
            </div>
        </div>
    );
}