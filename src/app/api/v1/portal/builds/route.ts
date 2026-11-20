import { api } from "@/lib/http";
import { portalBuilds } from "@/services/misc";
export const GET = api((c) => portalBuilds(c.env, c.user()));
