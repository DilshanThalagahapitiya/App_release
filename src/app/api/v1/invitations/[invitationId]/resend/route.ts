import { api } from "@/lib/http";
import { resendInvitation } from "@/services/orgs";
export const POST = api((c) => resendInvitation(c.env, c.user(), c.params.invitationId, c.req), { rate: ["invite", 60, 3600] });
