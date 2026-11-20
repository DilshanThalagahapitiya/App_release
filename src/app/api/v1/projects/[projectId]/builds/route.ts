import { api, Created } from "@/lib/http";
import { buildCreateSchema, paginationSchema } from "@/lib/schemas";
import { z } from "zod";
import { createBuild, listBuilds } from "@/services/builds";
const q = paginationSchema.extend({
  validation: z.enum(["pending", "running", "completed", "failed"]).optional(),
  eligibility: z.enum(["eligible", "eligible_with_warnings", "not_eligible", "needs_review"]).optional(),
  publish: z.enum(["unpublished", "published", "archived"]).optional(), uploader: z.string().uuid().optional(),
  from: z.string().optional(), to: z.string().optional(), sort: z.enum(["created", "version", "status"]).optional(),
});
export const GET = api((c) => listBuilds(c.env, c.user(), c.params.projectId, c.query(q)));
export const POST = api(async (c) => new Created(await createBuild(c.env, c.user(), c.params.projectId, await c.body(buildCreateSchema), c.req)));
