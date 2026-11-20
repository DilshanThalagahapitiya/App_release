import { api } from "@/lib/http";
import { z } from "zod";
import { NOTIFICATION_TYPES } from "@/lib/notify";
import { getPreferences, setPreference } from "@/services/misc";
const s = z.object({ eventType: z.enum(NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() });
export const GET = api((c) => getPreferences(c.env, c.user()));
export const PUT = api(async (c) => { const b = await c.body(s); return setPreference(c.env, c.user(), b.eventType, b.inApp, b.email); });
