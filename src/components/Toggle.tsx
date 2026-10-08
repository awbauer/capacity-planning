interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  small?: boolean;
}

/** An on/off switch with its label, for settings that filter or rearrange a view. */
export function Toggle({ label, checked, onChange, title, small }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={small ? 'toggle toggle-small' : 'toggle'}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </button>
  );
}
