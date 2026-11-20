import type { AppEnv } from "./env";
import { one, run } from "./db";
import { newId } from "./crypto";
import { nowIso } from "./time";

/** Provider abstraction. Add a provider by implementing `EmailProvider` and registering it in `resolveProvider`. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailProvider {
  name: string;
  send(msg: EmailMessage, env: AppEnv): Promise<void>;
}

const resend: EmailProvider = {
  name: "resend",
  async send(msg, env) {
    const from = env.EMAIL_FROM_NAME ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>` : env.EMAIL_FROM_ADDRESS!;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  },
};

export function resolveProvider(env: AppEnv): EmailProvider | null {
  if (!env.EMAIL_FROM_ADDRESS || !env.EMAIL_API_KEY) return null;
  if ((env.EMAIL_PROVIDER ?? "none") === "resend") return resend;
  return null;
}
export const emailConfigured = (env: AppEnv) => resolveProvider(env) !== null;

/**
 * Persist an email in the outbox. When no provider is configured the row is stored as
 * `not_configured` — it is NOT reported as sent. When configured, delivery is queued (Cloudflare Queue)
 * or attempted inline when no queue binding exists.
 */
export async function queueEmail(env: AppEnv, m: EmailMessage & { template: string; notificationId?: string }): Promise<"queued" | "not_configured"> {
  const provider = resolveProvider(env);
  const id = newId();
  await run(env.DB, "INSERT INTO email_outbox (id, to_email, template, subject, body, notification_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, m.to, m.template, m.subject, m.text, m.notificationId ?? null, provider ? "queued" : "not_configured", nowIso());
  if (!provider) return "not_configured";
  if (env.NOTIFY_QUEUE) await env.NOTIFY_QUEUE.send({ type: "email", outboxId: id });
  else await deliverOutbox(env, id);
  return "queued";
}

export async function deliverOutbox(env: AppEnv, outboxId: string): Promise<void> {
  const row = await one<{ id: string; to_email: string; subject: string; body: string; status: string; attempts: number; notification_id: string | null }>(
    env.DB, "SELECT * FROM email_outbox WHERE id = ?", outboxId);
  if (!row || row.status === "sent") return;
  const provider = resolveProvider(env);
  if (!provider) {
    await run(env.DB, "UPDATE email_outbox SET status = 'not_configured' WHERE id = ?", outboxId);
    return;
  }
  try {
    await provider.send({ to: row.to_email, subject: row.subject, text: row.body }, env);
    await run(env.DB, "UPDATE email_outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?", nowIso(), outboxId);
    if (row.notification_id) await run(env.DB, "UPDATE notifications SET email_state = 'sent' WHERE id = ?", row.notification_id);
  } catch (e) {
    const final = row.attempts + 1 >= 5;
    await run(env.DB, "UPDATE email_outbox SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?", final ? "failed" : "queued", String((e as Error).message).slice(0, 300), outboxId);
    if (final && row.notification_id) await run(env.DB, "UPDATE notifications SET email_state = 'failed' WHERE id = ?", row.notification_id);
    if (!final) throw e; // lets the queue retry with backoff
  }
}
