import { api } from "@/lib/http";
import { archiveBuild } from "@/services/builds";
export const POST = api((c) => archiveBuild(c.env, c.user(), c.params.buildId, c.req));
