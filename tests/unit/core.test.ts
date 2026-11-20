import { describe, expect, it } from "vitest";
import { ACTIONS, can, effectiveProjectRole, permissionMatrix } from "@/lib/permissions";
import { assessEligibility, decideInstallAction, moreConservative } from "@/lib/eligibility";
import { buildManifest, canTransition, linkState, xmlEscape, FEEDBACK_STATUSES, safeFilename, slugify } from "@/lib/rules";
import { hashPassword, hashToken, randomToken, signPayload, verifyPassword, verifyPayload, timingSafeEqual } from "@/lib/crypto";
import { validationReportSchema } from "@/lib/report-schema";
import { uploadSessionSchema, feedbackCreateSchema, inviteSchema, bundleIdSchema, passwordSchema, linkCreateSchema } from "@/lib/schemas";
import { qrPng, qrSvg } from "@/lib/qr";
import { sniffImageType, keys } from "@/lib/storage";
import { auditCsv } from "@/services/misc";
import { likeTerm } from "@/lib/db";

const NOW = new Date("2026-01-01T00:00:00Z");
const base = () => ({
  overallStatus: "completed" as const, errors: [], entitlements: {},
  app: { bundleIdentifier: "com.example.app" }, signing: { verification: "valid" as const },
  provisioning: { present: true, profileType: "ad_hoc" as const, expired: false, expiresAt: "2026-06-01T00:00:00Z", appIdMatchesBundle: true },
});

describe("permission matrix", () => {
  it("grants exactly what the spec roles imply", () => {
    expect(can("owner", "project:delete")).toBe(true);
    expect(can("project_admin", "project:delete")).toBe(false);
    expect(can("project_admin", "build:publish")).toBe(true);
    expect(can("qa_manager", "build:publish")).toBe(false);
    expect(can("qa_manager", "feedback:manage")).toBe(true);
    expect(can("qa_tester", "feedback:create")).toBe(true);
    expect(can("qa_tester", "feedback:view_all")).toBe(false);
    expect(can("qa_tester", "build:view_internal")).toBe(false);
    expect(can("viewer", "feedback:create")).toBe(false);
    expect(can("viewer", "build:view")).toBe(true);
    expect(can(null, "project:view")).toBe(false);
  });
  it("resolves effective roles: org admin implies admin; others need project assignment", () => {
    expect(effectiveProjectRole({ isPlatformOwner: true, orgRole: null, projectRole: null })).toBe("owner");
    expect(effectiveProjectRole({ isPlatformOwner: false, orgRole: "org_admin", projectRole: null })).toBe("org_admin");
    expect(effectiveProjectRole({ isPlatformOwner: false, orgRole: "qa_tester", projectRole: null })).toBeNull();
    expect(effectiveProjectRole({ isPlatformOwner: false, orgRole: "qa_tester", projectRole: "qa_tester" })).toBe("qa_tester");
    expect(effectiveProjectRole({ isPlatformOwner: false, orgRole: null, projectRole: "qa_tester" })).toBe("qa_tester"); // caller must separately require org membership
  });
  it("exposes a complete matrix (documented in docs/security.md)", () => {
    const m = permissionMatrix();
    expect(Object.keys(m).sort()).toEqual(["org_admin", "owner", "project_admin", "qa_manager", "qa_tester", "viewer"]);
    for (const r of Object.values(m)) expect(Object.keys(r)).toHaveLength(ACTIONS.length);
  });
});

describe("eligibility assessment", () => {
  it.each([
    ["valid ad hoc", {}, "eligible"],
    ["unsigned", { signing: { verification: "unsigned" as const } }, "not_eligible"],
    ["invalid signature", { signing: { verification: "invalid" as const } }, "not_eligible"],
    ["signature not verified", { signing: { verification: "not_performed" as const } }, "needs_review"],
    ["no profile", { provisioning: { present: false, profileType: "none" as const } }, "needs_review"],
    ["expired profile", { provisioning: { ...base().provisioning, expired: true } }, "not_eligible"],
    ["app id mismatch", { provisioning: { ...base().provisioning, appIdMatchesBundle: false } }, "not_eligible"],
    ["enterprise", { provisioning: { ...base().provisioning, profileType: "enterprise" as const } }, "eligible_with_warnings"],
    ["development", { provisioning: { ...base().provisioning, profileType: "development" as const } }, "eligible_with_warnings"],
    ["app store profile", { provisioning: { ...base().provisioning, profileType: "app_store" as const } }, "needs_review"],
    ["expiring soon", { provisioning: { ...base().provisioning, expiresAt: "2026-01-04T00:00:00Z" } }, "eligible_with_warnings"],
    ["worker errors", { errors: [{ code: "X", message: "m" }] }, "not_eligible"],
    ["no bundle id", { app: {} }, "not_eligible"],
  ])("%s -> %s", (_n, over, expected) => {
    expect(assessEligibility({ ...base(), ...over } as never, { now: NOW }).status).toBe(expected);
  });
  it("never infers anything from a filename and flags expected-bundle mismatches for review", () => {
    expect(assessEligibility(base() as never, { now: NOW, expectedBundleId: "com.other" }).status).toBe("needs_review");
  });
  it("OTA only for Ad Hoc/Enterprise that passed", () => {
    expect(assessEligibility(base() as never, { now: NOW }).otaSupported).toBe(true);
    expect(assessEligibility({ ...base(), provisioning: { ...base().provisioning, profileType: "development" } } as never, { now: NOW }).otaSupported).toBe(false);
    expect(assessEligibility({ ...base(), signing: { verification: "invalid" } } as never, { now: NOW }).otaSupported).toBe(false);
  });
  it("moreConservative picks the worse verdict", () => {
    expect(moreConservative("eligible", "not_eligible")).toBe("not_eligible");
    expect(moreConservative("needs_review", "eligible_with_warnings")).toBe("needs_review");
    expect(moreConservative("eligible", "eligible")).toBe("eligible");
  });
});

describe("install action decision", () => {
  const b = { distribution_method: "determine_from_ipa", eligibility_status: "eligible" as const, validation_status: "completed", profileType: "ad_hoc" as const, external_install_url: null, allow_download_when_ineligible: 0, link_allow_download: true };
  it("offers OTA only when eligible Ad Hoc/Enterprise", () => {
    expect(decideInstallAction(b).kind).toBe("ota");
    expect(decideInstallAction({ ...b, profileType: "development" }).kind).toBe("none");
    expect(decideInstallAction({ ...b, eligibility_status: "needs_review" }).kind).toBe("none");
    expect(decideInstallAction({ ...b, validation_status: "running" }).kind).toBe("none");
    expect(decideInstallAction({ ...b, link_allow_download: false }).kind).toBe("none");
  });
  it("download-only requires explicit admin opt-in", () => {
    const bad = { ...b, eligibility_status: "not_eligible" as const };
    expect(decideInstallAction(bad).kind).toBe("none");
    expect(decideInstallAction({ ...bad, allow_download_when_ineligible: 1 }).kind).toBe("download");
  });
  it("TestFlight/App Store link out only to configured https URLs", () => {
    expect(decideInstallAction({ ...b, distribution_method: "testflight", external_install_url: "https://testflight.apple.com/join/x" }).kind).toBe("external");
    expect(decideInstallAction({ ...b, distribution_method: "testflight", external_install_url: "http://x" }).kind).toBe("none");
    expect(decideInstallAction({ ...b, distribution_method: "app_store", external_install_url: null }).kind).toBe("none");
  });
});

describe("domain rules", () => {
  it("derives link state", () => {
    const l = { status: "active", expires_at: null, max_downloads: null, download_count: 0 };
    expect(linkState(l)).toBe("active");
    expect(linkState({ ...l, status: "revoked" })).toBe("revoked");
    expect(linkState({ ...l, status: "draft" })).toBe("draft");
    expect(linkState({ ...l, expires_at: "2020-01-01T00:00:00Z" })).toBe("expired");
    expect(linkState({ ...l, expires_at: "2999-01-01T00:00:00Z" })).toBe("active");
    expect(linkState({ ...l, max_downloads: 2, download_count: 2 })).toBe("exhausted");
    expect(linkState({ ...l, status: "revoked", expires_at: "2020-01-01T00:00:00Z" })).toBe("revoked");
  });
  it("feedback transitions", () => {
    expect(canTransition("new", "triaged")).toBe(true);
    expect(canTransition("new", "new")).toBe(false);
    expect(canTransition("closed", "resolved")).toBe(false);
    expect(canTransition("closed", "in_progress")).toBe(true);
    for (const s of FEEDBACK_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
  it("escapes XML and builds a valid OTA manifest only for https", () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
    const m = buildManifest({ ipaUrl: "https://h/f?a=1&b=2", bundleId: "com.example.app", version: "1.0", title: `A "<b>" App` });
    expect(m).toContain("a=1&amp;b=2");
    expect(m).toContain("A &quot;&lt;b&gt;&quot; App");
    expect(m).toContain("software-package");
    expect(() => buildManifest({ ipaUrl: "http://h/f", bundleId: "com.example.app", version: "1", title: "t" })).toThrow();
    expect(() => buildManifest({ ipaUrl: "https://h/f", bundleId: "bad id<", version: "1", title: "t" })).toThrow();
  });
  it("sanitises names", () => {
    expect(safeFilename('a/b"c\r\n.ipa')).not.toMatch(/[/"\r\n]/);
    expect(slugify("My  App!!")).toBe("my-app");
    expect(likeTerm("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("crypto", () => {
  it("tokens are long, unique and URL-safe; hashes are stable and not reversible to the token", async () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b); expect(a.length).toBeGreaterThanOrEqual(43); expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await hashToken(a)).toBe(await hashToken(a)); expect(await hashToken(a)).not.toContain(a); expect(await hashToken(a)).toHaveLength(64);
  });
  it("hashes passwords with unique salts and verifies correctly", async () => {
    const h1 = await hashPassword("correct horse battery"), h2 = await hashPassword("correct horse battery");
    expect(h1).not.toBe(h2); expect(h1).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword("correct horse battery", h1)).toBe(true);
    expect(await verifyPassword("wrong", h1)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("signed payloads detect tampering, wrong keys and expiry", async () => {
    const t = await signPayload("k".repeat(32), { a: 1, exp: Math.floor(Date.now() / 1000) + 60 });
    expect(await verifyPayload("k".repeat(32), t)).toMatchObject({ a: 1 });
    expect(await verifyPayload("z".repeat(32), t)).toBeNull();
    const [body, sig] = t.split(".");
    expect(await verifyPayload("k".repeat(32), body.slice(0, -2) + "xx." + sig)).toBeNull();
    expect(await verifyPayload("k".repeat(32), await signPayload("k".repeat(32), { exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    expect(await verifyPayload("k".repeat(32), await signPayload("k".repeat(32), { a: 1 }))).toBeNull(); // missing exp
    expect(timingSafeEqual("abc", "abc")).toBe(true); expect(timingSafeEqual("abc", "abd")).toBe(false); expect(timingSafeEqual("abc", "ab")).toBe(false);
  });
});

describe("schemas", () => {
  const goodReport = { schemaVersion: 1, overallStatus: "completed", eligibilityStatus: "eligible", file: { sizeBytes: 1, sha256: "a".repeat(64) }, checks: [], warnings: [], errors: [], limitations: [] };
  it("validates worker reports strictly", () => {
    expect(validationReportSchema.safeParse(goodReport).success).toBe(true);
    expect(validationReportSchema.safeParse({ ...goodReport, schemaVersion: 2 }).success).toBe(false);
    expect(validationReportSchema.safeParse({ ...goodReport, eligibilityStatus: "yes" }).success).toBe(false);
    expect(validationReportSchema.safeParse({ ...goodReport, file: { sizeBytes: -1, sha256: "a".repeat(64) } }).success).toBe(false);
    expect(validationReportSchema.safeParse({ ...goodReport, file: { sizeBytes: 1, sha256: "XYZ" } }).success).toBe(false);
    expect(validationReportSchema.safeParse({ ...goodReport, warnings: Array(60).fill("w") }).success).toBe(false);
  });
  it("validates upload sessions", () => {
    const ok = { filename: "A.ipa", sizeBytes: 10, sha256: "A".repeat(64) };
    expect(uploadSessionSchema.parse(ok).sha256).toBe("a".repeat(64));
    expect(uploadSessionSchema.safeParse({ ...ok, filename: "A.exe" }).success).toBe(false);
    expect(uploadSessionSchema.safeParse({ ...ok, sizeBytes: 0 }).success).toBe(false);
    expect(uploadSessionSchema.safeParse({ ...ok, sha256: "short" }).success).toBe(false);
  });
  it("validates other inputs", () => {
    expect(bundleIdSchema.safeParse("com.example.app").success).toBe(true);
    expect(bundleIdSchema.safeParse("nodots").success).toBe(false);
    expect(bundleIdSchema.safeParse("com.exa mple").success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(inviteSchema.parse({ email: "A@B.COM", role: "viewer" }).email).toBe("a@b.com");
    expect(inviteSchema.safeParse({ email: "a@b.com", role: "superuser" }).success).toBe(false);
    expect(feedbackCreateSchema.safeParse({ category: "crash", title: "t", description: "d", severity: "urgent" }).success).toBe(false);
    expect(linkCreateSchema.safeParse({ accessScope: "protected_link", maxDownloads: 0 }).success).toBe(false);
  });
});

describe("misc helpers", () => {
  it("renders valid QR SVG and PNG with a quiet zone", async () => {
    const svg = qrSvg("https://portal.test/d/abc");
    expect(svg.startsWith("<svg")).toBe(true); expect(svg).toContain('fill="#fff"');
    const png = await qrPng("https://portal.test/d/abc");
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.length).toBeGreaterThan(100);
  });
  it("sniffs image magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
  });
  it("builds object keys from ids only and neutralises CSV formulas", () => {
    expect(keys.ipa("o", "p", "b")).toBe("organisations/o/projects/p/builds/b/original/app.ipa");
    expect(auditCsv([{ created_at: "t", actor_name: "=cmd|' /C calc'!A0", action: "a,b" }])).toContain(`"'=cmd`);
  });
});
