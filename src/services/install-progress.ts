import type { AppEnv } from "@/lib/env";
import { one, run } from "@/lib/db";
import { nowIso } from "@/lib/time";
import { ipHash } from "@/lib/ratelimit";

export type InstallStage = "manifest" | "downloading" | "downloaded";

/** Record what iOS is doing for this link (called by the manifest and file routes). Best effort: never blocks an install. */
export async function setInstallStage(env: AppEnv, req: Request, linkId: string, stage: InstallStage, bytes = 0, total = 0): Promise<void> {
  try {
    await run(env.DB,
      `INSERT INTO install_progress (link_id, client_hash, stage, bytes, total, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(link_id, client_hash) DO UPDATE SET stage = excluded.stage, bytes = excluded.bytes, total = excluded.total, updated_at = excluded.updated_at`,
      linkId, await ipHash(env, req), stage, bytes, total, nowIso());
  } catch { /* progress is informational */ }
}

/** Progress for the person looking at the page. Prefers their own client; otherwise the most recent activity in the last 2 minutes. */
export async function getInstallProgress(env: AppEnv, req: Request, linkId: string, since: string) {
  const mine = await one<{ stage: InstallStage; bytes: number; total: number; updated_at: string }>(env.DB,
    "SELECT stage, bytes, total, updated_at FROM install_progress WHERE link_id = ? AND client_hash = ? AND updated_at >= ?", linkId, await ipHash(env, req), since);
  const row = mine ?? await one<{ stage: InstallStage; bytes: number; total: number; updated_at: string }>(env.DB,
    "SELECT stage, bytes, total, updated_at FROM install_progress WHERE link_id = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1", linkId, new Date(Math.max(Date.parse(since), Date.now() - 120000)).toISOString());
  if (!row) return { stage: "waiting" as const, percent: 0 };
  return { stage: row.stage, percent: row.total ? Math.min(100, Math.round((row.bytes / row.total) * 100)) : 0, updatedAt: row.updated_at };
}
