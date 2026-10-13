import type { Sql, SqlValue } from './sql';

/** The Sql interface on a Durable Object's SQLite storage. */
export function doSql(ctx: DurableObjectState): Sql {
  const sql = ctx.storage.sql;
  return {
    all: <T>(query: string, ...binds: SqlValue[]) => sql.exec(query, ...binds).toArray() as T[],
    script: (statements) => {
      sql.exec(statements);
    },
    transaction: (fn) => ctx.storage.transactionSync(fn),
  };
}
