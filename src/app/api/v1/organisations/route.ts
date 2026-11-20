import { api, Created } from "@/lib/http";
import { orgCreateSchema } from "@/lib/schemas";
import { createOrganisation, listOrganisations } from "@/services/orgs";
export const GET = api((c) => listOrganisations(c.env, c.user()));
export const POST = api(async (c) => new Created(await createOrganisation(c.env, c.user(), await c.body(orgCreateSchema), c.req)));
