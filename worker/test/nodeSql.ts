import { DatabaseSync } from 'node:sqlite';
import type { Sql, SqlValue } from '../sql';

/** The Sql interface on Node's built-in SQLite, for tests. */
export function nodeSql(): Sql & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    db,
    all: <T>(query: string, ...binds: SqlValue[]) => db.prepare(query).all(...binds) as T[],
    script: (s) => db.exec(s),
    transaction: (fn) => {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
