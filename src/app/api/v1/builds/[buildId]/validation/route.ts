import { api } from "@/lib/http";
import { getValidation } from "@/services/builds";
export const GET = api((c) => getValidation(c.env, c.user(), c.params.buildId));
