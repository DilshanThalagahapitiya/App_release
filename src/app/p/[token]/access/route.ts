import { api } from "@/lib/http";
import { linkAccessSchema } from "@/lib/schemas";
import { submitLinkPassword } from "@/services/distribution";
import { cookieHeader } from "@/lib/auth";
export const POST = api(async (c) => {
  const { password } = await c.body(linkAccessSchema);
  const g = await submitLinkPassword(c.env, c.req, c.params.token, password);
  const res = Response.json({ data: { granted: true }, meta: { requestId: c.requestId } });
  res.headers.append("set-cookie", cookieHeader(c.env, g.cookieName, g.cookieValue, g.maxAge, g.path));
  return res;
}, { auth: "public", rate: ["link-password", 10, 600] });
