import { api } from "@/lib/http";
import { feedbackUpdateSchema } from "@/lib/schemas";
import { getFeedback, updateFeedback } from "@/services/feedback";
export const GET = api((c) => getFeedback(c.env, c.user(), c.params.feedbackId));
export const PATCH = api(async (c) => updateFeedback(c.env, c.user(), c.params.feedbackId, await c.body(feedbackUpdateSchema), c.req));
