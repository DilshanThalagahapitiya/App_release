import { api } from "@/lib/http";
import { publishBuild } from "@/services/builds";
export const POST = api((c) => publishBuild(c.env, c.user(), c.params.buildId, c.req));
