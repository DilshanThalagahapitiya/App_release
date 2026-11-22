import { api } from "@/lib/http";
import { retryPreview } from "@/services/simulator";
export const POST = api((c) => retryPreview(c.env, c.user(), c.params.buildId, c.req));
