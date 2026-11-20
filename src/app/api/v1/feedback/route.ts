import { api } from "@/lib/http";
import { paginationSchema, FEEDBACK_CATEGORIES, SEVERITIES } from "@/lib/schemas";
import { FEEDBACK_STATUSES } from "@/lib/rules";
import { z } from "zod";
import { listFeedback } from "@/services/feedback";
const q = paginationSchema.extend({
  status: z.enum(FEEDBACK_STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), category: z.enum(FEEDBACK_CATEGORIES).optional(),
  buildId: z.string().uuid().optional(), assignee: z.string().uuid().optional(), projectId: z.string().uuid().optional(), sort: z.enum(["created", "updated", "severity"]).optional(),
});
export const GET = api((c) => { const p = c.query(q); return listFeedback(c.env, c.user(), { projectId: p.projectId }, p); });
