import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import { receiveAttachment } from "@/services/feedback";
export const PUT = api(async (c) => {
  const s = await getSettings(c.env);
  const len = Number(c.req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(len)) throw new ApiError("BAD_REQUEST", "Content-Length is required.");
  if (len > s.maxAttachmentBytes) throw new ApiError("PAYLOAD_TOO_LARGE", "Attachment is too large.");
  return receiveAttachment(c.env, c.user(), c.params.attachmentId, await c.req.arrayBuffer(), c.req);
});
