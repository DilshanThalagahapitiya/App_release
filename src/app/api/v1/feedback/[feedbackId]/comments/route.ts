import { api, Created } from "@/lib/http";
import { feedbackCommentSchema } from "@/lib/schemas";
import { addComment } from "@/services/feedback";
export const POST = api(async (c) => new Created(await addComment(c.env, c.user(), c.params.feedbackId, await c.body(feedbackCommentSchema), c.req)), { rate: ["comment", 120, 3600] });
