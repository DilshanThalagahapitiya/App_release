import { api } from "@/lib/http";
import { feedbackStatusSchema } from "@/lib/schemas";
import { changeStatus } from "@/services/feedback";
export const POST = api(async (c) => changeStatus(c.env, c.user(), c.params.feedbackId, await c.body(feedbackStatusSchema), c.req));
