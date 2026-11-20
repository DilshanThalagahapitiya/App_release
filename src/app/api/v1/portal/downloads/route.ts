import { api } from "@/lib/http";
import { portalDownloads } from "@/services/misc";
export const GET = api((c) => portalDownloads(c.env, c.user()));
