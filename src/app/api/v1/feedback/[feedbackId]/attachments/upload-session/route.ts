import { api, Created } from "@/lib/http";
import { attachmentSessionSchema } from "@/lib/schemas";
import { createAttachmentSession } from "@/services/feedback";
export const POST = api(async (c) => new Created(await createAttachmentSession(c.env, c.user(), c.params.feedbackId, await c.body(attachmentSessionSchema))), { rate: ["attach", 120, 3600] });
