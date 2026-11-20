import { api } from "@/lib/http";
import { removeProjectMember } from "@/services/projects";
export const DELETE = api((c) => removeProjectMember(c.env, c.user(), c.params.projectId, c.params.memberId, c.req));
