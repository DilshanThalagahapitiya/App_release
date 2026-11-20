import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { confirmInstall, resolveLink } from "@/services/distribution";
export const POST = api(async (c) => {
  const r = await resolveLink(c.env, c.req, c.params.token);
  if (r.access !== "granted") throw new ApiError("FORBIDDEN", "Access has not been granted.");
  return confirmInstall(c.env, r, c.req);
}, { auth: "public", rate: ["install-confirm", 30, 600] });
