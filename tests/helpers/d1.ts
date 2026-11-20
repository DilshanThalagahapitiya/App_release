import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** Minimal D1Database shim over better-sqlite3 so the real SQL + migrations run in tests. */
class Stmt {
  constructor(private db: Database.Database, private sql: string, private params: unknown[] = []) {}
  bind(...p: unknown[]) {
    for (const v of p) if (v === undefined) throw new Error(`D1 would reject undefined bind value in: ${this.sql.slice(0, 80)}`);
    return new Stmt(this.db, this.sql, p);
  }
  private prep() { return this.db.prepare(this.sql); }
  async first<T>(col?: string): Promise<T | null> {
    const s = this.prep();
    const row = (s.reader ? s.get(...this.params) : (s.run(...this.params), undefined)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T>() {
    const s = this.prep();
    const results = (s.reader ? s.all(...this.params) : (s.run(...this.params), [])) as T[];
    return { results, success: true, meta: {} };
  }
  async run() {
    const s = this.prep();
    if (s.reader) { s.all(...this.params); return { success: true, meta: { changes: 0 }, results: [] }; }
    const r = s.run(...this.params);
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) }, results: [] };
  }
  async raw() { return this.prep().raw().all(...this.params); }
  _exec() { return this.all(); }
}

export function createD1(): D1Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const dir = path.resolve(__dirname, "../../migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  return {
    prepare: (sql: string) => new Stmt(db, sql) as unknown as D1PreparedStatement,
    async batch(stmts: Stmt[]) {
      const out: unknown[] = [];
      db.exec("BEGIN");
      try { for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return out;
    },
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 }; },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}
