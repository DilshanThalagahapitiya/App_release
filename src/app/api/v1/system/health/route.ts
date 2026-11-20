import { api } from "@/lib/http";
import { health } from "@/services/misc";
export const GET = api(async (c) => health(c.env, !!c.actor?.isPlatformOwner), { auth: "public" });
