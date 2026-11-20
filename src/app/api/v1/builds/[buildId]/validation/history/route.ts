import { api } from "@/lib/http";
import { validationHistory } from "@/services/builds";
export const GET = api((c) => validationHistory(c.env, c.user(), c.params.buildId));
