import { api } from "@/lib/http";
import { workerFailSchema } from "@/lib/schemas";
import { failJob } from "@/services/worker";
export const POST = api(async (c) => failJob(c.env, c.worker!.id, c.params.jobId, await c.body(workerFailSchema)), { auth: "worker" });
