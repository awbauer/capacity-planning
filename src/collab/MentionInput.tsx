import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useCollabStore, type Person } from '../store/collabStore';
import { loadPeople } from '../store/sharedPlanStore';
import { fromEditable, toEditable } from './mentionText';

/** The `@query` being typed just before the caret, if any. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/[\s(]/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query)) return null;
  return { start: at, query };
}

interface Props {
  /** Initial body (mention tokens), for editing. */
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Sends the body; resolves when saved (the box empties), rejects to keep the draft. */
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
}

/** A comment box: type @ to mention someone; Ctrl/⌘+Enter sends. */
export function MentionInput({ initial = '', placeholder, submitLabel, autoFocus, disabled, onSubmit, onCancel }: Props) {
  const people = useCollabStore((s) => s.people);
  const [text, setText] = useState(() => toEditable(initial, people));
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadPeople();
  }, []);

  const q = mentionQuery(text, caret);
  const matches = useMemo(() => {
    if (!q || dismissed === q.start) return [];
    const needle = q.query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(needle) || p.email.includes(needle)).slice(0, 6);
  }, [q, people, dismissed]);

  const choose = (p: Person) => {
    if (!q) return;
    const insert = `@${p.name} `;
    const next = text.slice(0, q.start) + insert + text.slice(caret);
    const pos = q.start + insert.length;
    setText(next);
    setCaret(pos);
    setPick(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const body = fromEditable(text, people).trim();
    if (!body || busy) return;
    setBusy(true);
    onSubmit(body).then(
      () => {
        setBusy(false);
        setText('');
        setCaret(0);
      },
      () => setBusy(false),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(matches[Math.min(pick, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(q?.start ?? null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        maxLength={4000}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled || busy}
        aria-label={placeholder ?? 'Comment'}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="People to mention">
          {matches.map((p, i) => (
            <li key={p.email} role="option" aria-selected={i === pick}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                <strong>{p.name}</strong> <span className="muted small">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mention-actions">
        <span className="muted small">@ to mention · Ctrl+Enter to send</span>
        <span className="spacer" />
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={disabled || busy || !text.trim()} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
