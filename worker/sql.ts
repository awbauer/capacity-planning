/** A value SQLite can store. */
export type SqlValue = string | number | null;

/**
 * The little of SQLite the engines need, so they run the same on a Durable
 * Object's storage and (in tests) on Node's built-in SQLite. Synchronous,
 * like Durable Object SQL.
 */
export interface Sql {
  /** Runs one statement and returns its rows. */
  all<T = Record<string, SqlValue>>(query: string, ...binds: SqlValue[]): T[];
  /** Runs several statements (schema only; no binds). */
  script(statements: string): void;
  /** Runs `fn` atomically. */
  transaction<T>(fn: () => T): T;
}

export const one = <T>(rows: T[]): T | undefined => rows[0];

/** Small key/value table each engine keeps its counters in. */
export function metaGet(sql: Sql, key: string): string | undefined {
  return one(sql.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value;
}

export function metaSet(sql: Sql, key: string, value: string | number) {
  sql.all('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

/** Applies numbered migrations not yet run, tracked in meta.schema_version. */
export function migrate(sql: Sql, migrations: string[]) {
  sql.script('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const done = Number(metaGet(sql, 'schema_version') ?? 0);
  for (let i = done; i < migrations.length; i++) {
    sql.transaction(() => {
      sql.script(migrations[i]);
      metaSet(sql, 'schema_version', i + 1);
    });
  }
}
