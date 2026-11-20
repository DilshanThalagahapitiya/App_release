import { api } from "@/lib/http";
import { revokeWorker } from "@/services/worker";
export const DELETE = api((c) => revokeWorker(c.env, c.user(), c.params.workerId, c.req));
