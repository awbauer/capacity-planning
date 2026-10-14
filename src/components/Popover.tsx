import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** The trigger's content. */
  label: ReactNode;
  /** Accessible name of the trigger when its content isn't text (e.g. "•••"). */
  ariaLabel?: string;
  title?: string;
  className?: string;
  /** 'menu' for a list of actions (MenuItem children), 'dialog' for controls like filters. */
  kind?: 'menu' | 'dialog';
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A button that opens a floating panel under it. The panel is rendered into
 * the body and fixed to the viewport, so sticky or scrolling parents (the
 * grid) can't clip or cover it. It flips up near the bottom and keeps inside
 * the window horizontally.
 * Escape, a click outside or choosing a menu item closes it.
 */
export function Popover({ label, ariaLabel, title, className, kind = 'menu', children }: Props) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 200;
    const width = panel.current?.offsetWidth ?? 200;
    const up = r.bottom + height + 8 > window.innerHeight && r.top > height;
    // Right-aligned with the button when there's room, else left-aligned.
    const left = r.right - width >= 8 ? r.right - width : Math.min(r.left, window.innerWidth - width - 8);
    setStyle({
      position: 'fixed',
      left: Math.max(8, left),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
    if (kind === 'menu') panel.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus();
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      button.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className={`popover popover-${kind}`}
            role={kind}
            aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
            style={style}
            onClick={(e) => {
              if (kind === 'menu' && (e.target as HTMLElement).closest('[role=menuitem]')) close();
            }}
            onKeyDown={(e) => {
              if (kind !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
              e.preventDefault();
              const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])];
              const i = items.indexOf(document.activeElement as HTMLElement);
              items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

interface ItemProps {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

export function MenuItem({ onClick, children, danger, disabled, title }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'menu-item danger' : 'menu-item'}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
