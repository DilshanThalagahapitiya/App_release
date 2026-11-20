import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { recordDevice } from "@/services/devices";
// Called by iOS itself (no cookies, no Origin header), so the CSRF origin check does not apply. The token in the URL is the credential.
export const POST = api(async (c) => {
  const len = Number(c.req.headers.get("content-length") ?? 0);
  if (len > 64 * 1024) throw new ApiError("PAYLOAD_TOO_LARGE", "Too large.");
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.length > 64 * 1024) throw new ApiError("PAYLOAD_TOO_LARGE", "Too large.");
  const r = await recordDevice(c.env, c.req, c.params.token, body);
  // iOS requires HTTP 301 here to finish the enrolment flow and open this page.
  return new Response(null, { status: 301, headers: { location: `${c.env.APP_URL}/u/${r.token}/done`, "cache-control": "no-store" } });
}, { auth: "public", noCsrf: true, rate: ["device-callback", 60, 600] });
