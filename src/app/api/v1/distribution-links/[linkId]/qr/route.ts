import { api } from "@/lib/http";
import { qrTarget } from "@/services/distribution";
import { qrPng, qrSvg } from "@/lib/qr";
export const GET = api(async (c) => {
  const url = await qrTarget(c.env, c.user(), c.params.linkId);
  const format = c.url.searchParams.get("format") === "png" ? "png" : "svg";
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="distribution-qr.${format}"` };
  if (format === "png") return new Response(await qrPng(url) as unknown as BodyInit, { headers: { ...headers, "content-type": "image/png" } });
  return new Response(qrSvg(url), { headers: { ...headers, "content-type": "image/svg+xml", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
});
