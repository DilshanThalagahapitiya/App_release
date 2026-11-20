/**
 * Pure permission matrix. Server code resolves the caller's *effective project role*
 * (see access.ts) and then asks `can(role, action)`. UI hiding is cosmetic only.
 */
export const ORG_ROLES = ["org_admin", "project_admin", "qa_manager", "qa_tester", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const PROJECT_ROLES = ["project_admin", "qa_manager", "qa_tester", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
/** `owner` = Platform Owner (global). `org_admin` implicitly has admin rights on every project in the org. */
export type EffectiveRole = "owner" | "org_admin" | ProjectRole;

export const ACTIONS = [
  "project:view", "project:update", "project:delete", "project:members:manage",
  "build:view", "build:view_internal", "build:upload", "build:update", "build:publish", "build:archive",
  "build:delete", "build:download_ipa", "build:revalidate",
  "distribution:manage", "distribution:view",
  "feedback:view_all", "feedback:view_own", "feedback:create", "feedback:manage", "feedback:comment_internal",
  "audit:view_project",
] as const;
export type Action = (typeof ACTIONS)[number];

const ADMIN: Action[] = [...ACTIONS];
const MATRIX: Record<EffectiveRole, Action[]> = {
  owner: ADMIN,
  org_admin: ADMIN,
  project_admin: ADMIN.filter((a) => a !== "project:delete"),
  qa_manager: [
    "project:view", "build:view", "build:view_internal", "distribution:view",
    "feedback:view_all", "feedback:view_own", "feedback:create", "feedback:manage", "feedback:comment_internal",
  ],
  qa_tester: ["project:view", "build:view", "distribution:view", "feedback:view_own", "feedback:create"],
  viewer: ["project:view", "build:view", "distribution:view", "feedback:view_all"],
};

export function can(role: EffectiveRole | null | undefined, action: Action): boolean {
  return !!role && MATRIX[role].includes(action);
}

export function effectiveProjectRole(opts: {
  isPlatformOwner: boolean;
  orgRole: OrgRole | null; // active org membership role
  projectRole: ProjectRole | null; // active project membership role
}): EffectiveRole | null {
  if (opts.isPlatformOwner) return "owner";
  if (opts.orgRole === "org_admin") return "org_admin";
  return opts.projectRole; // everyone else needs an explicit project assignment
}

/** Roles that see the admin console; others use the customer portal. */
export const isStaffRole = (r: EffectiveRole | OrgRole | null | undefined) =>
  r === "owner" || r === "org_admin" || r === "project_admin" || r === "qa_manager";

export function permissionMatrix(): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const role of Object.keys(MATRIX) as EffectiveRole[]) {
    out[role] = Object.fromEntries(ACTIONS.map((a) => [a, can(role, a)]));
  }
  return out;
}
