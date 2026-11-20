import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { enrollmentProfile, resolveRequest } from "@/services/devices";
export const GET = api(async (c) => {
  const r = await resolveRequest(c.env, c.params.token);
  if (!r) throw new ApiError("LINK_UNAVAILABLE", "This request link is no longer active.");
  return new Response(enrollmentProfile(c.env, c.params.token, r), { headers: { "content-type": "application/x-apple-aspen-config; charset=utf-8", "content-disposition": 'attachment; filename="share-device-id.mobileconfig"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}, { auth: "public", rate: ["device-profile", 60, 600] });
