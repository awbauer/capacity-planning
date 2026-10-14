import { useCollabStore } from '../store/collabStore';

/** A name for an email, from the people list. */
export function useNameOf() {
  const people = useCollabStore((s) => s.people);
  return (email: string) => people.find((p) => p.email === email)?.name ?? email;
}
