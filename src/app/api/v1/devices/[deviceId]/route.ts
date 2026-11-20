import { api } from "@/lib/http";
import { deleteDevice } from "@/services/devices";
export const DELETE = api((c) => deleteDevice(c.env, c.user(), c.params.deviceId, c.req));
