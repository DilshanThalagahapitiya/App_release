import { api } from "@/lib/http";
import { projectUpdateSchema } from "@/lib/schemas";
import { deleteProject, getProject, updateProject } from "@/services/projects";
export const GET = api((c) => getProject(c.env, c.user(), c.params.projectId));
export const PATCH = api(async (c) => updateProject(c.env, c.user(), c.params.projectId, await c.body(projectUpdateSchema), c.req));
export const DELETE = api((c) => deleteProject(c.env, c.user(), c.params.projectId, c.req));
