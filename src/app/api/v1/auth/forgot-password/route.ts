import { api } from "@/lib/http";
import { forgotSchema } from "@/lib/schemas";
import { verifyTurnstile } from "@/lib/auth";
import { requestPasswordReset } from "@/services/misc";
export const POST = api(async (c) => {
  const { email, turnstileToken } = await c.body(forgotSchema);
  await verifyTurnstile(c.env, turnstileToken, c.req);
  return requestPasswordReset(c.env, c.req, email);
}, { auth: "public", rate: ["forgot", 10, 900] });
