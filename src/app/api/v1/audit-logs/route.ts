import { api } from "@/lib/http";
import { paginationSchema } from "@/lib/schemas";
import { z } from "zod";
import { auditCsv, listAuditLogs } from "@/services/misc";
const q = paginationSchema.extend({ action: z.string().max(60).optional(), resourceType: z.string().max(40).optional(), actorId: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(), organisationId: z.string().uuid().optional(), format: z.enum(["json", "csv"]).optional() });
export const GET = api(async (c) => {
  const p = c.query(q);
  if (p.format === "csv") {
    const r = await listAuditLogs(c.env, c.user(), { ...p, page: 1, pageSize: 100 });
    return new Response(auditCsv(r.items as Record<string, unknown>[]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"', "cache-control": "no-store" } });
  }
  return listAuditLogs(c.env, c.user(), p);
});
