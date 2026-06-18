import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const menuStyles = `
  @keyframes ctx-in {
    from { opacity: 0; transform: scale(0.92); }
    to   { opacity: 1; transform: scale(1); }
  }
  .ctx-menu {
    animation: ctx-in 120ms cubic-bezier(0.22, 1, 0.36, 1) both;
    transform-origin: top left;
  }
  .ctx-menu[data-anchor="bottom-right"] { transform-origin: top right; }
  .ctx-menu[data-anchor="top-left"]     { transform-origin: bottom left; }
  .ctx-menu[data-anchor="top-right"]    { transform-origin: bottom right; }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-radius: 5px;
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
    transition: background 80ms ease;
    color: var(--text);
  }
  .ctx-item.danger  { color: var(--red); }
  .ctx-item.disabled {
    color: var(--text3);
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  .ctx-item:not(.disabled):hover { background: var(--bg3); }
  .ctx-item:not(.disabled):active { background: var(--bg3); transform: scale(0.98); }

  .ctx-item i {
    font-size: 15px;
    flex-shrink: 0;
    opacity: 0.75;
  }
  .ctx-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
`;

export default function ContextMenu({ x, y, options, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [anchor, setAnchor] = useState('top-left');

  // Inject styles once
  useEffect(() => {
    const id = 'ctx-menu-styles';
    if (!document.getElementById(id)) {
      const tag = document.createElement('style');
      tag.id = id;
      tag.textContent = menuStyles;
      document.head.appendChild(tag);
    }
  }, []);

  // Clamp position before first paint — no flicker
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const pad = 8;
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top  = y;
    let flipX = false;
    let flipY = false;

    if (left + w > vw - pad) { left = Math.max(pad, vw - w - pad); flipX = true; }
    if (top  + h > vh - pad) { top  = Math.max(pad, vh - h - pad); flipY = true; }

    setPosition({ left, top });
    setAnchor(
      flipY && flipX ? 'top-right'
      : flipY        ? 'top-left'
      : flipX        ? 'bottom-right'
      :                'top-left'
    );
  }, [x, y]);

  // Close on outside click
  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      data-anchor={anchor}
      role="menu"
      aria-orientation="vertical"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: '9px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.12)',
        padding: '5px',
        zIndex: 9999,
        minWidth: '168px',
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {options.map((opt, i) => {
        if (opt.separator) return <div key={i} className="ctx-separator" role="separator" />;

        return (
          <button
            key={i}
            role="menuitem"
            disabled={opt.disabled}
            className={[
              'ctx-item',
              opt.danger   ? 'danger'   : '',
              opt.disabled ? 'disabled' : '',
            ].join(' ').trim()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              setTimeout(() => opt.action?.(), 0);
            }}
          >
            {opt.icon && <i className={`ti ti-${opt.icon}`} aria-hidden="true" />}
            <span>{opt.label}</span>
            {opt.shortcut && (
              <span style={{
                marginLeft: 'auto',
                fontSize: '11px',
                opacity: 0.45,
                letterSpacing: '0.02em',
                paddingLeft: 12,
              }}>
                {opt.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/*
  USAGE EXAMPLE:

  <ContextMenu
    x={mouseX}
    y={mouseY}
    onClose={() => setMenu(null)}
    options={[
      { label: 'Edit',      icon: 'edit',    action: handleEdit },
      { label: 'Duplicate', icon: 'copy',    action: handleDupe, shortcut: '⌘D' },
      { separator: true },
      { label: 'Delete',    icon: 'trash',   action: handleDelete, danger: true },
    ]}
  />
*/