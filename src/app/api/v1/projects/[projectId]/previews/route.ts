import { api } from "@/lib/http";
import { listProjectPreviews } from "@/services/simulator";
export const GET = api((c) => listProjectPreviews(c.env, c.user(), c.params.projectId));
