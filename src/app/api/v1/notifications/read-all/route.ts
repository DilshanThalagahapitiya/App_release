import { api } from "@/lib/http";
import { markAllRead } from "@/services/misc";
export const POST = api((c) => markAllRead(c.env, c.user()));
