import { api } from "@/lib/http";
import { login, verifyTurnstile, cookieHeader, SESSION_COOKIE } from "@/lib/auth";
import { loginSchema } from "@/lib/schemas";
import { bootstrapOwner } from "@/services/orgs";
import { me } from "@/services/misc";
import { actorFromToken } from "@/lib/auth";

export const POST = api(async (c) => {
  const { email, password, turnstileToken } = await c.body(loginSchema);
  await verifyTurnstile(c.env, turnstileToken, c.req);
  await bootstrapOwner(c.env);
  const s = await login(c.env, c.req, email, password);
  const actor = (await actorFromToken(c.env, s.token))!;
  const res = Response.json({ data: await me(c.env, actor), meta: { requestId: c.requestId } }, { headers: { "cache-control": "no-store" } });
  res.headers.append("set-cookie", cookieHeader(c.env, SESSION_COOKIE, s.token, s.maxAge));
  return res;
}, { auth: "public" });
