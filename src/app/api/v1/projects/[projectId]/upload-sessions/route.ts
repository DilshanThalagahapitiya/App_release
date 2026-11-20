import { api, Created } from "@/lib/http";
import { uploadSessionSchema } from "@/lib/schemas";
import { createUploadSession } from "@/services/builds";
export const POST = api(async (c) => new Created(await createUploadSession(c.env, c.user(), c.params.projectId, await c.body(uploadSessionSchema), c.req)), { rate: ["upload-init", 60, 3600] });
