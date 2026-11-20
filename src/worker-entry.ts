// Custom Worker entrypoint: delegates HTTP to the OpenNext-built Next.js app and adds
// Cron Trigger + Queue consumer handlers (not available from the Next.js runtime itself).
// @ts-expect-error — generated at build time by `opennextjs-cloudflare build`
import handler from "../.open-next/worker.js";
import type { AppEnv, NotifyMessage } from "./lib/env";
import { runDaily, runFrequent } from "./services/maintenance";
import { deliverOutbox } from "./lib/email";

// Re-export Durable Objects / classes OpenNext generates, if any, so wrangler can bind them.
// @ts-expect-error — generated
export * from "../.open-next/worker.js";

export default {
  fetch: (req: Request, env: unknown, ctx: ExecutionContext) => (handler as { fetch: typeof fetch & ((...a: unknown[]) => Promise<Response>) }).fetch(req, env, ctx),

  async scheduled(controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    // "*/5 * * * *" => frequent maintenance; "17 3 * * *" => daily retention.
    ctx.waitUntil(controller.cron === "17 3 * * *" ? runDaily(env) : runFrequent(env));
  },

  async queue(batch: MessageBatch<NotifyMessage>, env: AppEnv) {
    for (const msg of batch.messages) {
      try {
        if (msg.body.type === "email") await deliverOutbox(env, msg.body.outboxId);
        msg.ack();
      } catch {
        msg.retry({ delaySeconds: Math.min(900, 30 * 2 ** msg.attempts) });
      }
    }
  },
};
