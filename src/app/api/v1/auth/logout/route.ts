import { api, NoContent } from "@/lib/http";
import { clearCookie, revokeSession, SESSION_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const POST = api(async (c) => {
  const actor = c.actor;
  if (actor) {
    await revokeSession(c.env, actor.sessionId);
    await audit(c.env, { actorUserId: actor.userId, action: "auth.logout", resourceType: "user", resourceId: actor.userId, req: c.req });
  }
  const res = new Response(null, { status: 204 });
  res.headers.append("set-cookie", clearCookie(c.env, SESSION_COOKIE));
  void NoContent;
  return res;
}, { auth: "public" });
