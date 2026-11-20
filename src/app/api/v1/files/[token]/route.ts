import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { one } from "@/lib/db";
import { downloadHeaders, verifyFileGrant } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { safeFilename } from "@/lib/rules";

// Streams a private R2 object after verifying a short-lived HMAC grant. The grant names a DB record, never an object key.
export const GET = api(async (c) => {
  const g = await verifyFileGrant(c.env, c.params.token);
  if (!g) throw new ApiError("FORBIDDEN", "This download link is invalid or has expired.");
  let key: string | null = null; let name = "file"; let type = "application/octet-stream"; let inline = false; let org: string | null = null;
  if (g.k === "build") {
    const b = await one<{ r2_object_key: string; original_filename: string; organisation_id: string; deleted_at: string | null }>(c.env.DB, "SELECT r2_object_key, original_filename, organisation_id, deleted_at FROM builds WHERE id = ?", g.id);
    if (!b || b.deleted_at) throw new ApiError("NOT_FOUND", "File not found.");
    key = b.r2_object_key; name = safeFilename(b.original_filename); org = b.organisation_id;
  } else if (g.k === "attachment") {
    const a = await one<{ r2_object_key: string; original_filename: string; mime_type: string; status: string; feedback_id: string }>(c.env.DB, "SELECT a.r2_object_key, a.original_filename, a.mime_type, a.status, a.feedback_id FROM feedback_attachments a WHERE a.id = ?", g.id);
    if (!a || a.status !== "ready") throw new ApiError("NOT_FOUND", "File not found.");
    key = a.r2_object_key; name = safeFilename(a.original_filename); type = a.mime_type; inline = true;
  } else {
    const r = await one<{ report_r2_key: string }>(c.env.DB, "SELECT report_r2_key FROM validation_reports WHERE build_id = ? ORDER BY created_at DESC LIMIT 1", g.id);
    if (!r?.report_r2_key) throw new ApiError("NOT_FOUND", "File not found.");
    key = r.report_r2_key; name = "validation-report.json"; type = "application/json";
  }
  const range = c.req.headers.get("range");
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  const head = await c.env.BUCKET.head(key);
  if (!head) throw new ApiError("NOT_FOUND", "File not found.");
  if (m) {
    const start = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
    if (start > end || start >= head.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${head.size}` } });
    const part = await c.env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!part) throw new ApiError("NOT_FOUND", "File not found.");
    const h = downloadHeaders(name, type, end - start + 1, inline);
    h.set("content-range", `bytes ${start}-${end}/${head.size}`); h.set("accept-ranges", "bytes");
    return new Response(part.body, { status: 206, headers: h });
  }
  const obj = await c.env.BUCKET.get(key);
  if (!obj) throw new ApiError("NOT_FOUND", "File not found.");
  if (g.k === "build" && g.lid) await audit(c.env, { organisationId: org, actorUserId: g.uid ?? null, actorType: g.uid ? "user" : "anonymous", action: "distribution.file_served", resourceType: "distribution_link", resourceId: g.lid, req: c.req });
  const h = downloadHeaders(name, type, head.size, inline); h.set("accept-ranges", "bytes");
  return new Response(obj.body, { status: 200, headers: h });
}, { auth: "public", rate: ["files", 600, 600] });
