// Thin typed helpers over D1. All SQL in the codebase is parameterised (`?` binds) — never string-built from input.
// Dynamic identifiers (ORDER BY columns, table filters) come from fixed allow-lists only.

export type Row = Record<string, unknown>;

export async function one<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}
export async function batch(db: D1Database, stmts: D1PreparedStatement[]) {
  return db.batch(stmts);
}
export const stmt = (db: D1Database, sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params);

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Escape `%`/`_` so user search text is matched literally by LIKE ... ESCAPE '\'. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

export const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
