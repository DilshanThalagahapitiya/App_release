import { api } from "@/lib/http";
import { acceptInviteSchema } from "@/lib/schemas";
import { acceptInvitation } from "@/services/orgs";
import { cookieHeader, SESSION_COOKIE } from "@/lib/auth";
export const POST = api(async (c) => {
  const input = await c.body(acceptInviteSchema);
  const r = await acceptInvitation(c.env, c.req, input, c.actor);
  const res = Response.json({ data: { organisationId: r.organisationId, accountCreated: r.accountCreated, signedIn: !!r.session }, meta: { requestId: c.requestId } });
  if (r.session) res.headers.append("set-cookie", cookieHeader(c.env, SESSION_COOKIE, r.session.token, r.session.maxAge));
  return res;
}, { auth: "public", rate: ["invite-accept", 20, 900] });
