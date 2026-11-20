import { api } from "@/lib/http";
import { buildUpdateSchema } from "@/lib/schemas";
import { deleteBuild, getBuild, updateBuild } from "@/services/builds";
export const GET = api((c) => getBuild(c.env, c.user(), c.params.buildId));
export const PATCH = api(async (c) => updateBuild(c.env, c.user(), c.params.buildId, await c.body(buildUpdateSchema), c.req));
export const DELETE = api((c) => deleteBuild(c.env, c.user(), c.params.buildId, c.req));
