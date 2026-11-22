import { z } from "zod";
import { ORG_ROLES, PROJECT_ROLES } from "./permissions";
import { FEEDBACK_STATUSES } from "./rules";

const trimmed = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
export const bundleIdSchema = z.string().trim().regex(/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/, "Use reverse-DNS form, e.g. com.example.app").max(155);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12, "Use at least 12 characters").max(200);
export const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((s) => s.toLowerCase());
const httpsUrl = z.string().url().max(2048).refine((u) => u.startsWith("https://"), "Must be an https:// URL");

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200), turnstileToken: z.string().optional() });
export const forgotSchema = z.object({ email: emailSchema, turnstileToken: z.string().optional() });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200), displayName: trimmed(100).optional(), password: passwordSchema.optional() });

export const orgCreateSchema = z.object({
  name: trimmed(100), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,48}$/).optional(),
  adminEmail: emailSchema.optional(), timezone: z.string().max(64).default("UTC"),
});
export const orgUpdateSchema = z.object({
  name: trimmed(100).optional(), timezone: z.string().max(64).optional(),
  default_link_expiry_days: z.number().int().min(1).max(365).optional(),
  default_qa_instructions: optText(4000).optional(), status: z.enum(["active", "suspended", "archived"]).optional(),
}).strict();

export const inviteSchema = z.object({
  email: emailSchema, role: z.enum(ORG_ROLES), projectIds: z.array(z.string().uuid()).max(50).default([]),
  projectRole: z.enum(PROJECT_ROLES).optional(),
});
export const memberUpdateSchema = z.object({ role: z.enum(ORG_ROLES).optional(), status: z.enum(["active", "deactivated"]).optional() }).strict();

export const projectCreateSchema = z.object({
  organisationId: z.string().uuid().optional(), name: trimmed(100), description: optText(2000),
  app_display_name: optText(100), expected_bundle_identifier: bundleIdSchema.optional().nullable().or(z.literal("").transform(() => null)),
  default_qa_instructions: optText(4000), default_install_instructions: optText(4000),
  access_policy: z.enum(["named_users_only", "allow_protected_links"]).default("named_users_only"),
  feedback_enabled: z.boolean().default(true),
});
export const projectUpdateSchema = projectCreateSchema.omit({ organisationId: true }).partial().extend({ status: z.enum(["active", "paused", "archived"]).optional() }).strict();
export const projectMemberSchema = z.object({ userId: z.string().uuid(), role: z.enum(PROJECT_ROLES) });

export const DISTRIBUTION_METHODS = ["determine_from_ipa", "ad_hoc", "development", "enterprise", "testflight", "app_store", "download_only"] as const;

export const uploadSessionSchema = z.object({
  filename: z.string().trim().min(1).max(255).refine((f) => f.toLowerCase().endsWith(".ipa"), "File must have an .ipa extension"),
  sizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  mimeType: z.string().max(100).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export const buildCreateSchema = z.object({
  uploadSessionId: z.string().uuid(),
  releaseTitle: optText(200), releaseNotes: optText(8000), internalNotes: optText(8000),
  declaredVersion: optText(64), declaredBuildNumber: optText(64),
  distributionMethod: z.enum(DISTRIBUTION_METHODS).default("determine_from_ipa"),
  externalInstallUrl: httpsUrl.optional().nullable().or(z.literal("").transform(() => null)),
  allowDownloadWhenIneligible: z.boolean().default(false),
});
export const buildUpdateSchema = z.object({
  release_title: optText(200), release_notes: optText(8000), internal_notes: optText(8000),
  distribution_method: z.enum(DISTRIBUTION_METHODS), external_install_url: httpsUrl.nullable().or(z.literal("").transform(() => null)),
  allow_download_when_ineligible: z.boolean(),
}).partial().strict();

export const linkCreateSchema = z.object({
  title: trimmed(120).optional(),
  accessScope: z.enum(["named_users", "project_members", "protected_link"]),
  userIds: z.array(z.string().uuid()).max(500).default([]),
  password: z.string().min(6).max(100).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  maxDownloads: z.number().int().min(1).max(100000).optional().nullable(),
  allowDownload: z.boolean().default(true), allowFeedback: z.boolean().default(true),
  customerReleaseNotes: optText(8000), installationGuidance: optText(4000),
});
export const linkUpdateSchema = z.object({
  title: trimmed(120), expiresAt: z.string().datetime().nullable(), maxDownloads: z.number().int().min(1).nullable(),
  allowDownload: z.boolean(), allowFeedback: z.boolean(), customerReleaseNotes: optText(8000), installationGuidance: optText(4000),
}).partial().strict();
export const linkAccessSchema = z.object({ password: z.string().max(100).optional() });

export const FEEDBACK_CATEGORIES = ["crash", "ui_layout", "performance", "functional", "installation", "compatibility", "other"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const feedbackCreateSchema = z.object({
  buildId: z.string().uuid().optional().nullable(), category: z.enum(FEEDBACK_CATEGORIES), title: trimmed(200),
  description: trimmed(8000), severity: z.enum(SEVERITIES),
  reproductionSteps: optText(8000), expectedResult: optText(4000), actualResult: optText(4000),
  deviceModel: optText(100), iosVersion: optText(32),
  contactPreference: z.enum(["in_app", "email", "none"]).default("in_app"),
});
export const feedbackUpdateSchema = z.object({
  severity: z.enum(SEVERITIES), assignedToUserId: z.string().uuid().nullable(), category: z.enum(FEEDBACK_CATEGORIES),
}).partial().strict();
export const feedbackStatusSchema = z.object({ status: z.enum(FEEDBACK_STATUSES), note: optText(2000) });
export const feedbackCommentSchema = z.object({ body: trimmed(8000), visibility: z.enum(["internal", "customer"]).default("customer") });
export const attachmentSessionSchema = z.object({ filename: trimmed(255), mimeType: z.string().max(100), sizeBytes: z.number().int().positive() });

export const workerCreateSchema = z.object({ name: trimmed(80) });
export const workerHeartbeatSchema = z.object({ workerVersion: z.string().max(40), hostname: z.string().max(100).optional(), tools: z.record(z.string(), z.boolean()).optional() });
export const workerProgressSchema = z.object({ leaseToken: z.string().min(10), stage: z.string().max(60), percent: z.number().int().min(0).max(100), message: z.string().max(500).optional() });
export const workerLeaseSchema = z.object({ leaseToken: z.string().min(10) });
export const workerFailSchema = z.object({ leaseToken: z.string().min(10), errorCode: z.string().max(80), message: z.string().max(2000), retryable: z.boolean().default(true) });

export const settingsSchema = z.object({
  maxIpaBytes: z.number().int().min(1024 * 1024).max(5 * 1024 ** 3).optional(),
  maxAttachmentBytes: z.number().int().min(1024).max(50 * 1024 * 1024).optional(),
  allowedAttachmentTypes: z.array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/)).max(20).optional(),
  defaultLinkExpiryDays: z.number().int().min(1).max(365).optional(),
  auditRetentionDays: z.number().int().min(30).max(3650).optional(),
  downloadEventRetentionDays: z.number().int().min(7).max(3650).optional(),
  validationMode: z.enum(["on", "cloud", "off"]).optional(),
}).strict();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});
