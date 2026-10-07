import { useId, useState } from 'react';

export interface ComboOption {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  options: ComboOption[];
  placeholder: string;
  onSelect: (id: string) => void;
  /** When set, typing a name that doesn't exist offers to create it. */
  onCreate?: (label: string) => void;
  autoFocus?: boolean;
}

/** Type-to-filter picker that can create the typed value. */
export function Combobox({ options, placeholder, onSelect, onCreate, autoFocus }: Props) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => o.label.toLowerCase().includes(q));
  const exact = options.some((o) => o.label.toLowerCase() === q);
  const items: { key: string; label: string; color?: string; run: () => void }[] = matches.map((o) => ({
    key: o.id,
    label: o.label,
    color: o.color,
    run: () => onSelect(o.id),
  }));
  if (onCreate && q && !exact) {
    items.push({ key: '__create', label: `Create “${query.trim()}”`, run: () => onCreate(query.trim()) });
  }

  const choose = (i: number) => {
    items[i]?.run();
    setQuery('');
    setActive(0);
  };

  return (
    <div className="combo">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items.length) choose(active);
          } else if (e.key === 'Escape' && open) {
            // Close just the list, not an enclosing <dialog>.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && items.length > 0 && (
        <ul className="combo-list" id={listId} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === active}
              className={item.key === '__create' ? 'combo-create' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {item.color && <i className="dot" style={{ background: item.color }} />}
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
