import { api } from "@/lib/http";
import { unpublishBuild } from "@/services/builds";
export const POST = api((c) => unpublishBuild(c.env, c.user(), c.params.buildId, c.req));
