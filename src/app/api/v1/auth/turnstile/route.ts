import { api } from "@/lib/http";
// Publishes only the Turnstile SITE key (public by design). The secret key never leaves the server.
export const GET = api(async (c) => ({ siteKey: c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY ? c.env.TURNSTILE_SITE_KEY : null }), { auth: "public" });
