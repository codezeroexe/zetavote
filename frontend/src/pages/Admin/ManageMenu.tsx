import React, { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A "Manage" menu button. Button with aria-haspopup/aria-expanded, items with
 * role="menuitem". Arrow keys, Home and End move; Esc closes and returns focus.
 */
export const ManageMenu: React.FC<{ label: string; items: MenuItem[] }> = ({
  label,
  items,
}) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    refs.current[0]?.focus();
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const move = (i: number) =>
    refs.current[(i + items.length) % items.length]?.focus();

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next: Record<string, number | undefined> = {
      ArrowDown: i + 1,
      ArrowUp: i - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (e.key in next) {
      e.preventDefault();
      move(next[e.key]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="zv-a-menu" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="zv-btn zv-btn-outline zv-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        Manage <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="zv-a-menu-list zv-glass" role="menu" aria-label={label}>
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`zv-a-menu-item${item.danger ? " zv-a-menu-danger" : ""}`}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
