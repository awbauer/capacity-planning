import { usePlanStore } from '../store/planStore';
import { useDerived } from '../store/useDerived';
import { TagChip } from './Chips';
import { Combobox } from './Combobox';

interface Props {
  value: string[];
  onChange: (tagIds: string[]) => void;
  placeholder?: string;
}

/** Multi-select for capability tags; typing a new name creates the tag. */
export function TagPicker({ value, onChange, placeholder = 'Add capability…' }: Props) {
  const tags = usePlanStore((s) => s.plan.tags);
  const addTag = usePlanStore((s) => s.addTag);
  const { tagsById } = useDerived();
  const selected = new Set(value);
  return (
    <div className="tag-picker">
      {value.map((id) => {
        const tag = tagsById.get(id);
        return tag ? (
          <TagChip key={id} tag={tag} onRemove={() => onChange(value.filter((t) => t !== id))} />
        ) : null;
      })}
      <Combobox
        placeholder={placeholder}
        options={tags.filter((t) => !selected.has(t.id)).map((t) => ({ id: t.id, label: t.name, color: t.color }))}
        onSelect={(id) => onChange([...value, id])}
        onCreate={(name) => {
          const tag = addTag(name);
          if (!selected.has(tag.id)) onChange([...value, tag.id]);
        }}
      />
    </div>
  );
}
