import { api } from "@/lib/http";
import { z } from "zod";
import { completeJob } from "@/services/worker";
const s = z.object({ leaseToken: z.string().min(10), report: z.unknown() });
export const POST = api(async (c) => { const b = await c.body(s); return completeJob(c.env, c.worker!.id, c.params.jobId, { leaseToken: b.leaseToken, report: b.report }); }, { auth: "worker" });
