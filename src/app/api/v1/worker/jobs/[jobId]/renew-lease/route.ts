import { api } from "@/lib/http";
import { workerLeaseSchema } from "@/lib/schemas";
import { renewLease } from "@/services/worker";
export const POST = api(async (c) => renewLease(c.env, c.worker!.id, c.params.jobId, (await c.body(workerLeaseSchema)).leaseToken), { auth: "worker" });
