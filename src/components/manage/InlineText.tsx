import { useState } from 'react';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email';
  ariaLabel: string;
}

/** Text input that saves on blur or Enter (one undo step per edit, not per keystroke). */
export function InlineText({ value, onCommit, placeholder, required, type = 'text', ariaLabel }: Props) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    // External change (e.g. undo): show the new value.
    setSynced(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if (required && !next) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <input
      className="inline"
      type={type}
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

interface AddRowProps {
  placeholder: string;
  onAdd: (name: string) => void;
}

export function AddRow({ placeholder, onAdd }: AddRowProps) {
  const [name, setName] = useState('');
  return (
    <form
      className="add-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName('');
      }}
    >
      <input value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} aria-label={placeholder} />
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}
