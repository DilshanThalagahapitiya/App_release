import { api, Created } from "@/lib/http";
import { projectMemberSchema } from "@/lib/schemas";
import { addProjectMember, listProjectMembers } from "@/services/projects";
export const GET = api((c) => listProjectMembers(c.env, c.user(), c.params.projectId));
export const POST = api(async (c) => new Created(await addProjectMember(c.env, c.user(), c.params.projectId, await c.body(projectMemberSchema), c.req)));
