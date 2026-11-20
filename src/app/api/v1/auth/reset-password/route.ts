import { api } from "@/lib/http";
import { resetSchema } from "@/lib/schemas";
import { resetPassword } from "@/services/misc";
export const POST = api(async (c) => {
  const { token, password } = await c.body(resetSchema);
  return resetPassword(c.env, c.req, token, password);
}, { auth: "public", rate: ["reset", 10, 900] });
