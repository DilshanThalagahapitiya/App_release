import type { AppEnv } from "@/lib/env";
import { one, stmt, batch } from "@/lib/db";
import { newId } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import { audit } from "@/lib/audit";
import { keys } from "@/lib/storage";
import { notify, projectStaffIds } from "@/lib/notify";
import { assessEligibility, moreConservative } from "@/lib/eligibility";
import { validationReportSchema, type Eligibility, type ValidationReport } from "@/lib/report-schema";
import { inspectIpaSource, IpaInspectError, type ByteSource } from "@/lib/ipa-inspect";
import type { BuildRow, ProjectRow } from "@/lib/types";

const LIMITATIONS = [
  "Cloud check: Info.plist and the embedded provisioning profile were read inside the cloud; no Mac was used.",
  "The code signature is NOT cryptographically verified. Only the presence of a signature was checked.",
  "The provisioning profile's certificate chain was not validated against Apple's roots.",
  "Device UDID registration cannot be checked here for an unknown target device; Ad Hoc/Development installs are never guaranteed.",
  "The application was inspected statically; it was never executed.",
];

const bucketSource = (env: AppEnv, key: string, size: number): ByteSource => ({
  size: async () => size,
  read: async (offset, length) => {
    const o = await env.BUCKET.get(key, { range: { offset, length } });
    if (!o) throw new IpaInspectError("IPA_MISSING", "The uploaded IPA could not be read from storage.");
    return new Uint8Array(await o.arrayBuffer());
  },
});

/**
 * Inspect the stored IPA inside the Worker and record the result exactly like a worker report
 * (synthetic completed job + validation_reports row + build metadata), so publish/links/installs work unchanged.
 */
export async function runCloudCheck(env: AppEnv, buildId: string, opts: { actorUserId?: string | null; notifyStaff?: boolean } = {}) {
  const build = (await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", buildId))!;
  const project = (await one<ProjectRow>(env.DB, "SELECT * FROM projects WHERE id = ?", build.project_id))!;
  const now = nowIso(); const jobId = newId(); const reportId = newId();
  const file = { sizeBytes: build.file_size_bytes, sha256: build.sha256 };

  let report: ValidationReport; let eligibility: Eligibility; let failedReport = false; let warnings: string[] = [];
  try {
    const r = await inspectIpaSource(bucketSource(env, build.r2_object_key, build.file_size_bytes));
    const checks: ValidationReport["checks"] = [
      { code: "ZIP_READABLE", status: "passed", message: "The IPA is a readable ZIP archive with an app bundle." },
      { code: "INFO_PLIST_READ", status: "passed", message: `Bundle identifier ${r.app.bundleIdentifier}, version ${r.app.version ?? "?"} (${r.app.buildNumber ?? "?"}).` },
      { code: "PROFILE_READ", status: r.provisioning.present ? "passed" : "warning", message: r.provisioning.present ? `Embedded profile type: ${r.provisioning.profileType}.` : "No embedded provisioning profile was found." },
      { code: "CODE_SIGNATURE_PRESENT", status: r.signaturePresent ? "passed" : "failed", message: r.signaturePresent ? "A code signature is present." : "No code signature was found in the app bundle." },
      { code: "CODE_SIGNATURE_VERIFIED", status: "not_performed", message: "The signature was not cryptographically verified (cloud check)." },
    ];
    report = validationReportSchema.parse({
      schemaVersion: 1, overallStatus: "completed", eligibilityStatus: "needs_review", file, app: r.app,
      signing: { verification: r.signaturePresent ? "unknown" : "unsigned", teamIdentifier: r.provisioning.teamIdentifier },
      provisioning: { ...r.provisioning, expired: r.provisioning.expired }, entitlements: r.entitlements,
      checks, warnings: [], errors: [], limitations: LIMITATIONS,
    });
    // Reuse the standard rules, treating "signature present" as valid for the derivation only; the unverified signature is added as a warning.
    const derived = assessEligibility({ ...report, signing: { ...report.signing, verification: r.signaturePresent ? "valid" : "unsigned" } }, { expectedBundleId: project.expected_bundle_identifier });
    eligibility = moreConservative(derived.status, "eligible_with_warnings");
    warnings = [...new Set([...derived.reasons, ...derived.warnings, ...(r.signaturePresent ? ["Cloud check: the code signature was not verified, only detected."] : []), ...r.notes])];
    report = { ...report, eligibilityStatus: eligibility, warnings };
  } catch (e) {
    const err = e instanceof IpaInspectError ? e : new IpaInspectError("IPA_UNREADABLE", "The IPA could not be inspected.");
    failedReport = true; eligibility = "not_eligible";
    report = validationReportSchema.parse({
      schemaVersion: 1, overallStatus: "failed", eligibilityStatus: "not_eligible", file, app: {}, signing: { verification: "not_performed" },
      provisioning: { present: false, profileType: "none" }, entitlements: {},
      checks: [{ code: err.code, status: "failed", message: err.message }], warnings: [], errors: [{ code: err.code, message: err.message }], limitations: LIMITATIONS,
    });
    warnings = [err.message];
  }

  const reportKey = keys.report(build.organisation_id, build.project_id, build.id, reportId);
  const stored = JSON.stringify({ ...report, source: "cloud_check" });
  await env.BUCKET.put(reportKey, stored, { httpMetadata: { contentType: "application/json" } });
  await batch(env.DB, [
    stmt(env.DB, "INSERT INTO worker_jobs (id, build_id, job_type, status, attempt_count, max_attempts, progress_percent, stage, progress_message, idempotency_key, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      jobId, build.id, "validate_ipa", "completed", 0, 1, 100, "cloud_check", "Checked in the cloud (no Mac)", `cloud:${build.id}:${jobId}`, now, now, now),
    stmt(env.DB, `INSERT INTO validation_reports (id, build_id, worker_job_id, attempt, worker_version, overall_status, eligibility_status, metadata_json, signing_summary_json, profile_summary_json, entitlements_summary_json, checks_json, warnings_json, errors_json, limitations_json, report_r2_key, started_at, completed_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      reportId, build.id, jobId, 0, "cloud-check", report.overallStatus, eligibility, JSON.stringify({ file, app: report.app }), JSON.stringify(report.signing), JSON.stringify(report.provisioning),
      JSON.stringify(report.entitlements), JSON.stringify(report.checks), JSON.stringify(warnings), JSON.stringify(report.errors), JSON.stringify(report.limitations), reportKey, now, now, now),
    stmt(env.DB, "INSERT INTO build_files (id, build_id, file_type, r2_object_key, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?,?)", newId(), build.id, "validation_report", reportKey, "application/json", stored.length, now),
    stmt(env.DB,
      `UPDATE builds SET validation_status = ?, eligibility_status = ?, processing_status = ?, validated_at = ?,
         app_name = ?, bundle_identifier = ?, version = ?, build_number = ?, minimum_os_version = ?, supported_device_families_json = ?, architectures_json = ?, updated_at = ? WHERE id = ?`,
      failedReport ? "failed" : "completed", eligibility, failedReport ? "failed" : "complete", now,
      report.app.name ?? null, report.app.bundleIdentifier ?? null, report.app.version ?? build.declared_version, report.app.buildNumber ?? build.declared_build_number,
      report.app.minimumOSVersion ?? null, JSON.stringify(report.app.deviceFamilies ?? []), JSON.stringify(report.app.architectures ?? []), now, build.id),
  ]);
  await audit(env, { organisationId: build.organisation_id, actorUserId: opts.actorUserId ?? null, action: "build.cloud_checked", resourceType: "build", resourceId: build.id, metadata: { eligibility, failed: failedReport } });
  if (opts.notifyStaff !== false) {
    await notify(env, { userIds: await projectStaffIds(env, build.project_id, build.organisation_id), organisationId: build.organisation_id, type: failedReport ? "validation_failed" : "validation_completed",
      title: `Check ${failedReport ? "failed" : "completed"}: ${report.app.name ?? build.original_filename}`, body: `Eligibility: ${eligibility.replace(/_/g, " ")}`, resourceType: "build", resourceId: build.id, path: `/app/builds/${build.id}/validation` });
  }
  return { jobId, eligibility, failed: failedReport };
}
