import type { Eligibility, ProfileType, ValidationReport } from "./report-schema";

/**
 * Eligibility rules. The macOS worker applies the same rules (worker/app/ipa/eligibility.py);
 * the API re-derives eligibility from the reported *facts* and keeps the MORE CONSERVATIVE
 * of the two verdicts, so a buggy or compromised worker cannot upgrade a build on its own.
 *
 * Nothing here proves a build installs on a given device. Ad Hoc / Development builds also
 * require the device UDID to be inside the profile; the platform cannot see the target device.
 */
export interface EligibilityOutcome {
  status: Eligibility;
  profileType: ProfileType;
  /** OTA (itms-services) is only ever offered for Ad Hoc / Enterprise builds that passed checks. */
  otaSupported: boolean;
  reasons: string[];
  warnings: string[];
}

const RANK: Record<Eligibility, number> = { eligible: 0, eligible_with_warnings: 1, needs_review: 2, not_eligible: 3 };
export const moreConservative = (a: Eligibility, b: Eligibility): Eligibility => (RANK[a] >= RANK[b] ? a : b);

export function assessEligibility(
  r: Pick<ValidationReport, "overallStatus" | "signing" | "provisioning" | "app" | "errors" | "entitlements">,
  opts: { expectedBundleId?: string | null; now?: Date } = {},
): EligibilityOutcome {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const out = (status: Eligibility, ota = false): EligibilityOutcome => ({
    status, profileType: r.provisioning.profileType, otaSupported: ota && status !== "not_eligible" && status !== "needs_review", reasons, warnings,
  });

  if (r.overallStatus !== "completed" || r.errors.length > 0) {
    reasons.push("Package inspection did not complete cleanly: " + (r.errors[0]?.message ?? "unknown error"));
    return out("not_eligible");
  }
  if (!r.app.bundleIdentifier) {
    reasons.push("No bundle identifier could be read from Info.plist.");
    return out("not_eligible");
  }
  if (r.signing.verification === "unsigned" || r.signing.verification === "invalid") {
    reasons.push(`Code signature is ${r.signing.verification}.`);
    return out("not_eligible");
  }
  if (r.signing.verification !== "valid") {
    reasons.push("The code signature could not be verified on the worker.");
    return out("needs_review");
  }

  const p = r.provisioning;
  if (!p.present) {
    reasons.push("No embedded provisioning profile was found. This is normal for App Store/TestFlight exports, but such builds cannot be installed over the air from this platform.");
    return out("needs_review");
  }
  const expired = p.expired ?? (p.expiresAt ? new Date(p.expiresAt) < now : undefined);
  if (expired === undefined) {
    reasons.push("Provisioning profile expiry could not be determined.");
    return out("needs_review");
  }
  if (expired) {
    reasons.push("The embedded provisioning profile has expired.");
    return out("not_eligible");
  }
  if (p.appIdMatchesBundle === false) {
    reasons.push("The provisioning profile application identifier does not match the bundle identifier.");
    return out("not_eligible");
  }
  if (p.appIdMatchesBundle == null) warnings.push("Profile application identifier could not be compared with the bundle identifier.");

  if (opts.expectedBundleId && opts.expectedBundleId !== r.app.bundleIdentifier) {
    reasons.push(`Bundle identifier ${r.app.bundleIdentifier} differs from the project's expected identifier ${opts.expectedBundleId}.`);
    return out("needs_review");
  }

  if (p.expiresAt) {
    const days = (new Date(p.expiresAt).getTime() - now.getTime()) / 86400000;
    if (days < 14) warnings.push(`The provisioning profile expires in ${Math.max(0, Math.floor(days))} day(s).`);
  }

  switch (p.profileType) {
    case "ad_hoc":
      warnings.push("Ad Hoc: installs only on devices whose UDID is registered in the provisioning profile.");
      return out(warnings.length > 1 ? "eligible_with_warnings" : "eligible", true);
    case "enterprise":
      warnings.push("Enterprise: limited to qualifying organisations and internal proprietary use under Apple's current terms.");
      return out("eligible_with_warnings", true);
    case "development":
      warnings.push("Development-signed build: requires a development profile and registered devices; not general distribution. Over-the-air install is not offered.");
      return out("eligible_with_warnings", false);
    case "app_store":
      reasons.push("App Store style profile: distribute through TestFlight or App Store Connect.");
      return out("needs_review");
    default:
      reasons.push("The provisioning profile type could not be determined.");
      return out("needs_review");
  }
}

export interface InstallAction {
  kind: "ota" | "external" | "download" | "none";
  label?: string;
  reason: string;
}

/** Decides what the customer page may offer. Never offers an install button on weak evidence. */
export function decideInstallAction(b: {
  distribution_method: string;
  eligibility_status: Eligibility;
  validation_status: string;
  profileType?: ProfileType | null;
  external_install_url?: string | null;
  allow_download_when_ineligible: number | boolean;
  link_allow_download: boolean;
}): InstallAction {
  const m = b.distribution_method;
  if (m === "testflight" || m === "app_store") {
    if (b.external_install_url?.startsWith("https://"))
      return { kind: "external", label: m === "testflight" ? "Open in TestFlight" : "Open official install page", reason: "Installation is handled by Apple's own workflow." };
    return { kind: "none", reason: "The official Apple install link has not been configured for this build." };
  }
  if (b.validation_status !== "completed") return { kind: "none", reason: "This build has not finished validation." };
  const ok = b.eligibility_status === "eligible" || b.eligibility_status === "eligible_with_warnings";
  const ota = ok && (b.profileType === "ad_hoc" || b.profileType === "enterprise") &&
    (m === "determine_from_ipa" || m === b.profileType);
  if (ota && b.link_allow_download) return { kind: "ota", label: "Install", reason: "Eligible for over-the-air installation on registered devices." };
  if (b.allow_download_when_ineligible && b.link_allow_download)
    return { kind: "download", label: "Download IPA", reason: "Download only. Installation is not guaranteed; see the eligibility notes." };
  return { kind: "none", reason: ok ? "Downloads are disabled for this link." : "This build is not eligible for installation from this platform." };
}
