import { api } from "@/lib/http";
import { uploadPart } from "@/services/builds";
import { ApiError } from "@/lib/errors";
export const PUT = api(async (c) => {
  const len = Number(c.req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(len)) throw new ApiError("BAD_REQUEST", "Content-Length is required.");
  return uploadPart(c.env, c.user(), c.params.sessionId, Number(c.params.partNumber), c.req.body, len);
});
