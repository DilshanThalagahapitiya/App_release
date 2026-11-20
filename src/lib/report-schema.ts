import { z } from "zod";

export const ELIGIBILITY = ["eligible", "eligible_with_warnings", "not_eligible", "needs_review"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];
export const PROFILE_TYPES = ["development", "ad_hoc", "enterprise", "app_store", "unknown", "none"] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

const str = (max = 512) => z.string().max(max);

export const checkSchema = z.object({
  code: str(80),
  status: z.enum(["passed", "failed", "warning", "skipped", "not_performed"]),
  message: str(1000),
});

/** Versioned schema of the report produced by the macOS worker. Validated by the API before persistence. */
export const validationReportSchema = z.object({
  schemaVersion: z.literal(1),
  overallStatus: z.enum(["completed", "failed"]),
  eligibilityStatus: z.enum(ELIGIBILITY),
  file: z.object({ sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  app: z
    .object({
      name: str().nullable().optional(),
      bundleIdentifier: str(255).nullable().optional(),
      version: str(64).nullable().optional(),
      buildNumber: str(64).nullable().optional(),
      minimumOSVersion: str(32).nullable().optional(),
      deviceFamilies: z.array(z.number().int()).max(8).optional(),
      architectures: z.array(str(32)).max(16).optional(),
    })
    .default({}),
  signing: z
    .object({
      verification: z.enum(["valid", "invalid", "unsigned", "unknown", "not_performed"]),
      identitySummary: str().nullable().optional(),
      teamIdentifier: str(64).nullable().optional(),
      authorities: z.array(str()).max(10).optional(),
    })
    .default({ verification: "not_performed" }),
  provisioning: z
    .object({
      present: z.boolean(),
      profileType: z.enum(PROFILE_TYPES),
      name: str().nullable().optional(),
      uuid: str(64).nullable().optional(),
      teamIdentifier: str(64).nullable().optional(),
      applicationIdentifier: str(255).nullable().optional(),
      createdAt: str(64).nullable().optional(),
      expiresAt: str(64).nullable().optional(),
      expired: z.boolean().optional(),
      deviceRegistrationRequired: z.boolean().optional(),
      deviceCount: z.number().int().nonnegative().nullable().optional(),
      appIdMatchesBundle: z.boolean().nullable().optional(),
    })
    .default({ present: false, profileType: "none" }),
  entitlements: z
    .object({
      applicationIdentifier: str(255).nullable().optional(),
      getTaskAllow: z.boolean().nullable().optional(),
      apsEnvironment: str(32).nullable().optional(),
      associatedDomainsCount: z.number().int().nonnegative().optional(),
      keys: z.array(str(120)).max(100).optional(),
    })
    .default({}),
  checks: z.array(checkSchema).max(100),
  warnings: z.array(str(1000)).max(50),
  errors: z.array(z.object({ code: str(80), message: str(1000) })).max(50),
  limitations: z.array(str(1000)).max(50),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;
