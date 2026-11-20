import { api, Created } from "@/lib/http";
import { linkCreateSchema } from "@/lib/schemas";
import { createLink, listLinks } from "@/services/distribution";
export const GET = api((c) => listLinks(c.env, c.user(), c.params.buildId));
export const POST = api(async (c) => new Created(await createLink(c.env, c.user(), c.params.buildId, await c.body(linkCreateSchema), c.req)), { rate: ["link-create", 120, 3600] });
