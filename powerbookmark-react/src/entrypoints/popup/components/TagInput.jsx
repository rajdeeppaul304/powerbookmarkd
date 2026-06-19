import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function TagInput({ value, onChange }) {
    const [allTags, setAllTags] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const dropdownRef = useRef(null);

    useEffect(() => {
        api.getRecentBookmarks().then(data => {
            const tags = new Set();
            (data.bookmarks || []).forEach(b => (b.tags || []).forEach(t => tags.add(t)));
            setAllTags([...tags].sort());
        }).catch(() => {});
    }, []);

    function getCurrentWord(val) {
        const parts = val.split(',');
        return parts[parts.length - 1].trim();
    }

    function replaceLastWord(val, replacement) {
        const parts = val.split(',');
        parts[parts.length - 1] = ' ' + replacement;
        return parts.join(',').replace(/^,\s*/, '');
    }

    function handleChange(e) {
        const val = e.target.value;
        onChange(val);
        const word = getCurrentWord(val);
        if (word.length < 1) {
            setSuggestions([]);
            return;
        }
        const existing = val.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const filtered = allTags.filter(t =>
            t.includes(word.toLowerCase()) && !existing.includes(t)
        ).slice(0, 6);
        setSuggestions(filtered);
        setActiveIdx(-1);
    }

    function pickSuggestion(tag) {
        onChange(replaceLastWord(value, tag) + ', ');
        setSuggestions([]);
        setActiveIdx(-1);
    }

    function handleKeyDown(e) {
        if (!suggestions.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => Math.max(i - 1, -1));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (activeIdx >= 0) {
                e.preventDefault();
                pickSuggestion(suggestions[activeIdx]);
            } else {
                setSuggestions([]);
            }
        } else if (e.key === 'Escape') {
            setSuggestions([]);
        }
    }

    return (
        <div style={{ position: 'relative' }}>
            <input
                type="text"
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                placeholder="e.g. linux, wayland, kde"
            />
            {suggestions.length > 0 && (
                <div ref={dropdownRef} style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0, right: 0,
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    zIndex: 100,
                    overflow: 'hidden',
                    marginTop: 2,
                }}>
                    {suggestions.map((tag, i) => (
                        <div
                            key={tag}
                            onMouseDown={() => pickSuggestion(tag)}
                            style={{
                                padding: '7px 10px',
                                fontSize: 12,
                                cursor: 'pointer',
                                background: i === activeIdx ? 'var(--bg4)' : 'transparent',
                                color: i === activeIdx ? 'var(--text)' : 'var(--text2)',
                                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                            }}
                        >
                            <span style={{ color: 'var(--blue)', marginRight: 6 }}>#</span>
                            {tag}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}