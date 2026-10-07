export function newId(): string {
  return crypto.randomUUID();
}

export const TAG_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
];

/** Picks the palette color used least so far, so new tags stay distinguishable. */
export function nextTagColor(used: string[]): string {
  const counts = new Map(TAG_COLORS.map((c) => [c, 0]));
  for (const c of used) if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  let best = TAG_COLORS[0];
  for (const c of TAG_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}
