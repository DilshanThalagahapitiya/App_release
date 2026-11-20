import { api } from "@/lib/http";
import { workerHeartbeatSchema } from "@/lib/schemas";
import { heartbeat } from "@/services/worker";
export const POST = api(async (c) => heartbeat(c.env, c.worker!.id, await c.body(workerHeartbeatSchema)), { auth: "worker" });
