import { api } from "@/lib/http";
import { orgUpdateSchema } from "@/lib/schemas";
import { getOrganisation, updateOrganisation } from "@/services/orgs";
export const GET = api((c) => getOrganisation(c.env, c.user(), c.params.organisationId));
export const PATCH = api(async (c) => updateOrganisation(c.env, c.user(), c.params.organisationId, await c.body(orgUpdateSchema), c.req));
