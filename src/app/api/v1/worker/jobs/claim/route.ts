import { api } from "@/lib/http";
import { claimJob } from "@/services/worker";
export const POST = api(async (c) => ({ job: await claimJob(c.env, c.worker!.id) }), { auth: "worker" });
