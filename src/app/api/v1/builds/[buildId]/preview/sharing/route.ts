import { api } from "@/lib/http";
import { previewSharingSchema } from "@/lib/schemas";
import { getPreviewSharing, setPreviewSharing } from "@/services/simulator";
export const GET = api((c) => getPreviewSharing(c.env, c.user(), c.params.buildId));
export const PUT = api(async (c) => setPreviewSharing(c.env, c.user(), c.params.buildId, await c.body(previewSharingSchema), c.req));
