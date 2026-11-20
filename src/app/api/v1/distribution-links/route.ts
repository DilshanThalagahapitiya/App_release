import { api } from "@/lib/http";
import { listProjectLinks } from "@/services/distribution";
export const GET = api((c) => listProjectLinks(c.env, c.user(), c.url.searchParams.get("projectId") ?? undefined));
