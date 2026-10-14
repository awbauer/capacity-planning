import { bodyParts, mentionToken } from '../domain/comments';
import type { Person } from '../store/collabStore';

/** A body with `<@email>` tokens as the editable text people see (`@Name`). */
export function toEditable(body: string, people: Person[]): string {
  const name = (e: string) => people.find((p) => p.email === e)?.name ?? e;
  return bodyParts(body)
    .map((p) => ('mention' in p ? `@${name(p.mention)}` : p.text))
    .join('');
}

/**
 * Editable text back to a body: `@Name` (for anyone in the people list,
 * longest names first) and `@email` become mention tokens.
 */
export function fromEditable(text: string, people: Person[]): string {
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const rest = text.slice(i + 1);
      const hit =
        sorted.find((p) => rest.toLowerCase().startsWith(p.email.toLowerCase()) && !/[\w.-]/.test(rest[p.email.length] ?? ' ')) ??
        sorted.find((p) => rest.toLowerCase().startsWith(p.name.toLowerCase()) && !/\w/.test(rest[p.name.length] ?? ' '));
      if (hit) {
        const matched = rest.toLowerCase().startsWith(hit.email.toLowerCase()) ? hit.email : hit.name;
        out += mentionToken(hit.email);
        i += 1 + matched.length;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}
