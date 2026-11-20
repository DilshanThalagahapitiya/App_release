import { api } from "@/lib/http";
import { memberUpdateSchema } from "@/lib/schemas";
import { removeMember, updateMember } from "@/services/orgs";
export const PATCH = api(async (c) => updateMember(c.env, c.user(), c.params.organisationId, c.params.memberId, await c.body(memberUpdateSchema), c.req));
export const DELETE = api((c) => removeMember(c.env, c.user(), c.params.organisationId, c.params.memberId, c.req));
