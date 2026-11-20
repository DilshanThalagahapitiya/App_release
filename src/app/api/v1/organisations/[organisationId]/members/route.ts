import { api } from "@/lib/http";
import { listMembers } from "@/services/orgs";
export const GET = api((c) => listMembers(c.env, c.user(), c.params.organisationId));
