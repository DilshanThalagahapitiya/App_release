import { api, Created } from "@/lib/http";
import { feedbackCreateSchema, paginationSchema, FEEDBACK_CATEGORIES, SEVERITIES } from "@/lib/schemas";
import { FEEDBACK_STATUSES } from "@/lib/rules";
import { z } from "zod";
import { createFeedback, listFeedback } from "@/services/feedback";
const q = paginationSchema.extend({
  status: z.enum(FEEDBACK_STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), category: z.enum(FEEDBACK_CATEGORIES).optional(),
  buildId: z.string().uuid().optional(), assignee: z.string().uuid().optional(), sort: z.enum(["created", "updated", "severity"]).optional(),
});
export const GET = api((c) => listFeedback(c.env, c.user(), { projectId: c.params.projectId }, c.query(q)));
export const POST = api(async (c) => new Created(await createFeedback(c.env, c.user(), c.params.projectId, await c.body(feedbackCreateSchema), c.req)), { rate: ["feedback", 60, 3600] });
