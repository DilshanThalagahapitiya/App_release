import { api, Created } from "@/lib/http";
import { paginationSchema, projectCreateSchema } from "@/lib/schemas";
import { z } from "zod";
import { createProject, listProjects } from "@/services/projects";
const q = paginationSchema.extend({ status: z.enum(["active", "paused", "archived"]).optional(), sort: z.enum(["updated", "name", "created"]).optional(), organisationId: z.string().uuid().optional() });
export const GET = api((c) => listProjects(c.env, c.user(), c.query(q)));
export const POST = api(async (c) => new Created(await createProject(c.env, c.user(), await c.body(projectCreateSchema), c.req)));
