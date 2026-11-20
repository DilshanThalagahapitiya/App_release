import { api } from "@/lib/http";
import { cancelJob } from "@/services/worker";
export const POST = api((c) => cancelJob(c.env, c.user(), c.params.jobId, c.req));
