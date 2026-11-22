import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "./env";
import { actorFromToken, SESSION_COOKIE } from "./auth";
import { me } from "@/services/misc";

/** Server-side route protection. Pages/layouts call this; client-side guards are never relied upon. */
export async function requireSession(area: "admin" | "customer" | "any" = "any") {
  const env = await getEnv();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actor = await actorFromToken(env, token);
  // Only say "session expired" if there was a session cookie; a first visit just goes to the login page.
  if (!actor) redirect(token ? "/auth/login?expired=1" : "/auth/login");
  const profile = await me(env, actor);
  if (area === "admin" && profile.portal !== "admin") redirect("/access-denied");
  return { env, actor, profile };
}
