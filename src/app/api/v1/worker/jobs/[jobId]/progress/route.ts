import { api } from "@/lib/http";
import { workerProgressSchema } from "@/lib/schemas";
import { reportProgress } from "@/services/worker";
export const POST = api(async (c) => reportProgress(c.env, c.worker!.id, c.params.jobId, await c.body(workerProgressSchema)), { auth: "worker" });
