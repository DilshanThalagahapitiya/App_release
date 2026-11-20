import { api } from "@/lib/http";
import { linkUpdateSchema } from "@/lib/schemas";
import { getLink, updateLink } from "@/services/distribution";
export const GET = api((c) => getLink(c.env, c.user(), c.params.linkId));
export const PATCH = api(async (c) => updateLink(c.env, c.user(), c.params.linkId, await c.body(linkUpdateSchema), c.req));
