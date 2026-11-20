import { api } from "@/lib/http";
import { revalidateBuild } from "@/services/builds";
export const POST = api((c) => revalidateBuild(c.env, c.user(), c.params.buildId, c.req));
