import { usePlanStore } from '../store/planStore';

interface Props {
  value: string | null;
  onChange: (sellerId: string | null) => void;
}

const NEW = '__new';

export function SellerPicker({ value, onChange }: Props) {
  const sellers = usePlanStore((s) => s.plan.sellers);
  const addSeller = usePlanStore((s) => s.addSeller);
  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NEW) {
          const name = window.prompt('New seller name')?.trim();
          if (name) onChange(addSeller(name).id);
          return;
        }
        onChange(v || null);
      }}
    >
      <option value="">— No seller —</option>
      {[...sellers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      <option value={NEW}>+ New seller…</option>
    </select>
  );
}
