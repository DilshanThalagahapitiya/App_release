import { api } from "@/lib/http";
import { paginationSchema } from "@/lib/schemas";
import { z } from "zod";
import { listNotifications } from "@/services/misc";
const q = paginationSchema.extend({ unread: z.enum(["1", "true"]).optional() });
export const GET = api((c) => { const p = c.query(q); return listNotifications(c.env, c.user(), { page: p.page, pageSize: p.pageSize, unread: !!p.unread }); });
