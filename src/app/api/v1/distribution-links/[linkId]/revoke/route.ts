import { api } from "@/lib/http";
import { revokeLink } from "@/services/distribution";
export const POST = api((c) => revokeLink(c.env, c.user(), c.params.linkId, c.req));
