import { api, Created } from "@/lib/http";
import { z } from "zod";
import { appleDeviceList, createRequest, listDevices } from "@/services/devices";
const create = z.object({ label: z.string().trim().min(1).max(100), expiresInDays: z.number().int().min(1).max(60).default(14) });
export const GET = api(async (c) => {
  const d = await listDevices(c.env, c.user(), c.params.projectId);
  if (c.url.searchParams.get("format") === "txt")
    return new Response(appleDeviceList(d.devices as never), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="devices.txt"', "cache-control": "no-store" } });
  return d;
});
export const POST = api(async (c) => new Created(await createRequest(c.env, c.user(), c.params.projectId, await c.body(create), c.req)), { rate: ["device-request", 60, 3600] });
