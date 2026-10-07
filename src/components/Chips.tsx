import type { CSSProperties } from 'react';
import type { CapabilityTag } from '../domain/types';

interface ChipProps {
  tag: CapabilityTag;
  onRemove?: () => void;
  dim?: boolean;
}

export function TagChip({ tag, onRemove, dim }: ChipProps) {
  return (
    <span className={dim ? 'chip chip-dim' : 'chip'} style={{ '--chip': tag.color } as CSSProperties}>
      <i aria-hidden />
      {tag.name}
      {onRemove && (
        <button type="button" aria-label={`Remove ${tag.name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

interface ChipListProps {
  tagIds: string[];
  tagsById: Map<string, CapabilityTag>;
  /** Tags not in this set render dimmed (e.g. resource tags the project doesn't need). */
  highlight?: Set<string>;
}

export function TagChips({ tagIds, tagsById, highlight }: ChipListProps) {
  const names = tagIds.map((id) => tagsById.get(id)?.name).filter(Boolean).join(', ');
  return (
    <span className="chips" title={names || undefined}>
      {tagIds.map((id) => {
        const tag = tagsById.get(id);
        return tag ? <TagChip key={id} tag={tag} dim={highlight && !highlight.has(id)} /> : null;
      })}
    </span>
  );
}
