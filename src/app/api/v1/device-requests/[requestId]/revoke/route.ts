import { api } from "@/lib/http";
import { revokeRequest } from "@/services/devices";
export const POST = api((c) => revokeRequest(c.env, c.user(), c.params.requestId, c.req));
