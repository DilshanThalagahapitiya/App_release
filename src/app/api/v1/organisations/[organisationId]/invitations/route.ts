import { api, Created } from "@/lib/http";
import { inviteSchema } from "@/lib/schemas";
import { inviteMember } from "@/services/orgs";
export const POST = api(async (c) => new Created(await inviteMember(c.env, c.user(), c.params.organisationId, await c.body(inviteSchema), c.req)), { rate: ["invite", 60, 3600] });
