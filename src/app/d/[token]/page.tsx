import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { installAction, logEvent, publicView, resolveLink } from "@/services/distribution";
import { signAccessGrant } from "@/lib/storage";
import { fmtBytes } from "@/lib/format";
import { PublicActions, PasswordForm } from "./client";

export const metadata = { title: "Install build", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}
function Notice({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (<Shell><div className="card space-y-3 p-6 text-center"><h1 className="text-lg font-semibold">{title}</h1><p className="text-[var(--text-2)]">{body}</p>{href && <a href={href} className="inline-block rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-text)]" style={{ textDecoration: "none", color: "var(--accent-text)" }}>{cta}</a>}</div></Shell>);
}

export default async function DistributionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const env = await getEnv();
  const h = await headers();
  const req = new Request(`${env.APP_URL}/d/${token}`, { headers: { cookie: h.get("cookie") ?? "", "user-agent": h.get("user-agent") ?? "", "cf-connecting-ip": h.get("cf-connecting-ip") ?? "" } });
  let r;
  try { r = await resolveLink(env, req, token); }
  catch (e) { if (e instanceof ApiError) return <Notice title="Link not found" body="This link doesn't exist or has been removed. Check that you copied it completely." />; throw e; }

  if (r.access === "unavailable") return <Notice title={r.state === "revoked" ? "This link was revoked" : r.state === "expired" ? "This link has expired" : r.state === "exhausted" ? "Download limit reached" : "This build is no longer available"} body="Ask the person who shared it with you for a new link." />;
  if (r.access === "login_required") return <Notice title="Sign in to continue" body="This build was shared with specific people. Sign in with the account you were invited with." href={`/auth/login?next=${encodeURIComponent(`/d/${token}`)}`} cta="Sign in" />;
  if (r.access === "denied") return <Notice title="You don't have access" body={r.reason ?? "This link was not shared with your account."} />;
  if (r.access === "password_required") return (<Shell><div className="card space-y-3 p-6"><h1 className="text-lg font-semibold">Password required</h1><p className="text-[var(--text-2)]">Enter the password you were given with this link.</p><PasswordForm token={token} /></div></Shell>);

  await logEvent(env, r, req, "page_open");
  const v = await publicView(env, r);
  const grant = await signAccessGrant(env, { lid: r.link.id, uid: r.user?.userId ?? null }, 900);
  const manifest = `${env.APP_URL}/d/${token}/manifest.plist?a=${encodeURIComponent(grant)}`;
  const action = await installAction(env, r);
  const eligTone = v.eligibility === "eligible" ? "good" : v.eligibility === "not_eligible" ? "bad" : "warn";
  return (
    <Shell>
      {r.staffPreview && <div className="rounded-lg bg-[var(--info-soft)] px-3 py-2 text-[13px]">Staff preview — your actions here do not count against download limits.</div>}
      <div className="card p-5">
        <p className="text-xs muted">{v.organisation} · {v.project}</p>
        <div className="mt-2 flex items-center gap-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-xl font-bold text-[var(--accent)]" aria-hidden>{v.appName.slice(0, 1)}</div><div className="min-w-0"><h1 className="truncate text-lg font-semibold">{v.appName}</h1><p className="text-[13px] text-[var(--text-2)]">Version {v.version ?? "?"} ({v.buildNumber ?? "?"})</p></div></div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div><dt className="muted text-xs">Released</dt><dd>{v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : "—"}</dd></div><div><dt className="muted text-xs">Size</dt><dd>{fmtBytes(v.fileSizeBytes)}</dd></div>
          <div><dt className="muted text-xs">Requires</dt><dd>{v.minimumOS ? `iOS ${v.minimumOS}+` : "—"}</dd></div><div><dt className="muted text-xs">Method</dt><dd>{v.profileType ? v.profileType.replace(/_/g, " ") : v.distributionMethod.replace(/_/g, " ")}</dd></div>
          <div className="col-span-2"><dt className="muted text-xs">Available until</dt><dd>{v.expiresAt ? new Date(v.expiresAt).toLocaleString() : "No expiry"}</dd></div>
        </dl>
        <div className={`mt-4 rounded-lg px-3 py-2 text-[13px] ${eligTone === "good" ? "bg-[var(--good-soft)]" : eligTone === "bad" ? "bg-[var(--bad-soft)]" : "bg-[var(--warn-soft)]"}`}>
          <p className="font-medium">{v.eligibility === "eligible" ? "Eligible for installation" : v.eligibility === "eligible_with_warnings" ? "Eligible, with conditions" : v.eligibility === "not_eligible" ? "Not eligible for installation" : "Needs review"}</p>
          {v.warnings.length > 0 && <ul className="mt-1 list-disc pl-5">{v.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      </div>
      <div className="card space-y-3 p-5">
        {action.kind === "ota" && <PublicActions kind="ota" installHref={`itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`} token={token} />}
        {action.kind === "external" && <a href={r.build.external_install_url!} rel="noopener noreferrer" className="block rounded-xl bg-[var(--accent)] px-4 py-3 text-center text-base font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>{action.label}</a>}
        {action.kind === "download" && <PublicActions kind="download" installHref={`/d/${token}/download?a=${encodeURIComponent(grant)}`} token={token} />}
        {action.kind === "none" && <p className="rounded-lg bg-[var(--surface-2)] px-3 py-3 text-[13px]">No install button is shown: {action.reason}</p>}
        <p className="text-xs muted">{action.reason} Opening this page or starting a download does not guarantee installation — Apple&apos;s signing, provisioning and device registration rules always apply.{(v.profileType === "ad_hoc" || v.profileType === "development") && " Your device must be registered in the build's provisioning profile."}</p>
      </div>
      {(v.releaseNotes || v.installationGuidance || v.qaInstructions) && <div className="card space-y-3 p-5 text-[13px]">
        {v.releaseNotes && <div><h2 className="font-semibold">What&apos;s new</h2><p className="whitespace-pre-wrap text-[var(--text-2)]">{v.releaseNotes}</p></div>}
        {v.installationGuidance && <div><h2 className="font-semibold">Installation</h2><p className="whitespace-pre-wrap text-[var(--text-2)]">{v.installationGuidance}</p></div>}
        {v.qaInstructions && <div><h2 className="font-semibold">What to test</h2><p className="whitespace-pre-wrap text-[var(--text-2)]">{v.qaInstructions}</p></div>}</div>}
      {v.allowFeedback && <a href={r.user ? `/portal/feedback/new?projectId=${v.projectId}&buildId=${v.buildId}` : `/auth/login?next=${encodeURIComponent(`/d/${token}`)}`} className="block rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-center font-medium" style={{ color: "var(--text)", textDecoration: "none" }}>Report an issue</a>}
    </Shell>
  );
}
