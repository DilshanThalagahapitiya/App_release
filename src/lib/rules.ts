// Small pure domain rules shared by services, UI and tests.

export type LinkState = "draft" | "active" | "expired" | "revoked" | "exhausted";

export function linkState(
  l: { status: string; expires_at: string | null; max_downloads: number | null; download_count: number },
  now = new Date(),
): LinkState {
  if (l.status === "revoked") return "revoked";
  if (l.status === "draft") return "draft";
  if (l.expires_at && new Date(l.expires_at) <= now) return "expired";
  if (l.max_downloads != null && l.download_count >= l.max_downloads) return "exhausted";
  return "active";
}

export const FEEDBACK_STATUSES = ["new", "triaged", "in_progress", "need_more_info", "resolved", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  new: ["triaged", "in_progress", "need_more_info", "resolved", "closed"],
  triaged: ["in_progress", "need_more_info", "resolved", "closed"],
  in_progress: ["triaged", "need_more_info", "resolved", "closed"],
  need_more_info: ["triaged", "in_progress", "resolved", "closed"],
  resolved: ["in_progress", "closed", "triaged"],
  closed: ["triaged", "in_progress"], // reopen
};
export const canTransition = (from: FeedbackStatus, to: FeedbackStatus) => from !== to && TRANSITIONS[from].includes(to);

export const PIPELINE_STAGES = [
  { key: "upload_received", label: "Upload received" },
  { key: "integrity_check", label: "File integrity check" },
  { key: "structure_inspection", label: "IPA structure inspection" },
  { key: "metadata_extraction", label: "Metadata extraction" },
  { key: "signature_inspection", label: "Signature/profile inspection" },
  { key: "eligibility_assessment", label: "Distribution eligibility assessment" },
  { key: "complete", label: "Complete" },
] as const;

export const DEFAULT_ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic"];
export const DEFAULT_MAX_IPA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const IPA_PART_SIZE = 32 * 1024 * 1024; // R2 multipart part size; each part is one Worker request

/** Escape for XML text/attribute content (used by the OTA manifest). */
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Build an OTA manifest only from validated metadata + HTTPS URLs. Throws otherwise. */
export function buildManifest(o: { ipaUrl: string; bundleId: string; version: string; title: string }): string {
  if (!o.ipaUrl.startsWith("https://")) throw new Error("OTA manifests require an HTTPS IPA URL.");
  if (!/^[A-Za-z0-9.-]{1,255}$/.test(o.bundleId)) throw new Error("Invalid bundle identifier.");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${xmlEscape(o.ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${xmlEscape(o.bundleId)}</string>
        <key>bundle-version</key><string>${xmlEscape(o.version)}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xmlEscape(o.title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}

/** Safe filename for Content-Disposition; never used for object keys. */
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

export function summariseUserAgent(ua: string | null): string {
  if (!ua) return "unknown";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "other";
  const br = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "other";
  return `${os}/${br}`;
}
