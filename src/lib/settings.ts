import type { AppEnv } from "./env";
import { all, run } from "./db";
import { nowIso } from "./time";
import { DEFAULT_ALLOWED_ATTACHMENT_TYPES, DEFAULT_MAX_ATTACHMENT_BYTES, DEFAULT_MAX_IPA_BYTES } from "./rules";

export interface PlatformSettings {
  maxIpaBytes: number;
  maxAttachmentBytes: number;
  allowedAttachmentTypes: string[];
  defaultLinkExpiryDays: number;
  auditRetentionDays: number;
  downloadEventRetentionDays: number;
  /** "on": macOS worker validates every upload. "cloud": inspected inside the cloud (no Mac, signature not verified). "off": accepted as-is. */
  validationMode: "on" | "cloud" | "off";
}

export const SETTING_DEFAULTS: PlatformSettings = {
  maxIpaBytes: DEFAULT_MAX_IPA_BYTES,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  allowedAttachmentTypes: DEFAULT_ALLOWED_ATTACHMENT_TYPES,
  defaultLinkExpiryDays: 14,
  auditRetentionDays: 365,
  downloadEventRetentionDays: 180,
  validationMode: "on",
};

export async function getSettings(env: AppEnv): Promise<PlatformSettings> {
  const rows = await all<{ key: string; value_json: string }>(env.DB, "SELECT key, value_json FROM platform_settings");
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value_json); } catch { /* ignore corrupt row; default stays */ }
  }
  return out as unknown as PlatformSettings;
}

export async function updateSettings(env: AppEnv, patch: Partial<PlatformSettings>, userId: string) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    await run(env.DB, "INSERT INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      k, JSON.stringify(v), userId, nowIso());
  }
  return getSettings(env);
}
