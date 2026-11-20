import { api } from "@/lib/http";
import { markRead } from "@/services/misc";
export const POST = api((c) => markRead(c.env, c.user(), c.params.notificationId));
