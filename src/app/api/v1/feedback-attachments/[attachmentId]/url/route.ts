import { api } from "@/lib/http";
import { attachmentUrl } from "@/services/feedback";
export const GET = api((c) => attachmentUrl(c.env, c.user(), c.params.attachmentId));
