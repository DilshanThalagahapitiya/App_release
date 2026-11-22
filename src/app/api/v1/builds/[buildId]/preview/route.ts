import { api } from "@/lib/http";
import { previewUpdateSchema } from "@/lib/schemas";
import { deletePreview, getBuildPreview, updatePreview } from "@/services/simulator";
export const GET = api((c) => getBuildPreview(c.env, c.user(), c.params.buildId));
export const PATCH = api(async (c) => updatePreview(c.env, c.user(), c.params.buildId, await c.body(previewUpdateSchema), c.req));
export const DELETE = api((c) => deletePreview(c.env, c.user(), c.params.buildId, c.req));
