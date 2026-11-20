import { api } from "@/lib/http";
import { abortUpload, getUploadSession } from "@/services/builds";
export const GET = api((c) => getUploadSession(c.env, c.user(), c.params.sessionId));
export const DELETE = api((c) => abortUpload(c.env, c.user(), c.params.sessionId, c.req));
