import { api } from "@/lib/http";
import { revokeInvitation } from "@/services/orgs";
export const POST = api((c) => revokeInvitation(c.env, c.user(), c.params.invitationId, c.req));
