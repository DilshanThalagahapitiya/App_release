import { api } from "@/lib/http";
import { completeUpload } from "@/services/builds";
export const POST = api((c) => completeUpload(c.env, c.user(), c.params.sessionId, c.req), { rate: ["upload-complete", 120, 3600] });
