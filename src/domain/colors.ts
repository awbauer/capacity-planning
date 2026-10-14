const PRESENCE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

/** A stable colour per person, for presence and "recently changed by" markers. */
export function colorFor(email: string): string {
  const h = [...email].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}
