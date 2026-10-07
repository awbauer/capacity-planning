import { derive, type Derived } from '../domain/derive';
import { usePlan } from './planStore';

export function useDerived(): Derived {
  return derive(usePlan());
}
