import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { installAction, logEvent, publicView, resolveLink } from "@/services/distribution";
import { signAccessGrant } from "@/lib/storage";
import { fmtBytes } from "@/lib/format";
import { PublicActions, PasswordForm } from "./client";
import { AppFrame, type FrameTab } from "@/components/app-frame";

export const metadata = { title: "Install build", robots: { index: false, follow: false } };

const Single = ({ children }: { children: React.ReactNode }) => <AppFrame title="Crede Releases" tabs={[{ id: "x", label: "", icon: "install", content: children }]} />;
function Notice({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (<Single><div className="card space-y-3 p-6 text-center"><h2 className="text-lg font-semibold">{title}</h2><p className="text-[var(--text-2)]">{body}</p>{href && <a href={href} className="inline-block rounded-2xl bg-[var(--accent)] px-6 py-3 text-[17px] font-semibold" style={{ textDecoration: "none", color: "var(--accent-text)" }}>{cta}</a>}</div></Single>);
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex items-center justify-between gap-4 px-4 py-3 text-[15px]"><dt className="text-[var(--text-2)]">{k}</dt><dd className="min-w-0 text-right font-medium">{v}</dd></div>;

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
  if (r.access === "password_required") return (<Single><div className="card space-y-3 p-6"><h2 className="text-lg font-semibold">Password required</h2><p className="text-[var(--text-2)]">Enter the password you were given with this link.</p><PasswordForm token={token} /></div></Single>);

  await logEvent(env, r, req, "page_open");
  const v = await publicView(env, r);
  const grant = await signAccessGrant(env, { lid: r.link.id, uid: r.user?.userId ?? null }, 900);
  const manifest = `${env.APP_URL}/d/${token}/manifest.plist?a=${encodeURIComponent(grant)}`;
  const action = await installAction(env, r);
  const eligTone = v.eligibility === "eligible" ? "good" : v.eligibility === "not_eligible" ? "bad" : "warn";
  const adHoc = v.profileType === "ad_hoc" || v.profileType === "development";

  const install = (
    <>
      {r.staffPreview && <div className="rounded-xl bg-[var(--info-soft)] px-4 py-2.5 text-[13px]">Staff preview — your actions here do not count against download limits.</div>}
      <section className="card px-5 pb-5 pt-7 text-center">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[22px] bg-gradient-to-br from-[#4f9bff] to-[#1f5fd1] text-4xl font-bold text-white shadow-md" aria-hidden>{v.appName.slice(0, 1).toUpperCase()}</div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight">{v.appName}</h2>
        <p className="mt-0.5 text-[15px] text-[var(--text-2)]">Version {v.version ?? "?"} ({v.buildNumber ?? "?"})</p>
        <p className="text-[13px] text-[var(--text-3)]">{v.organisation} · {v.project}</p>
        <div className="mt-5 space-y-3 text-left">
          {action.kind === "ota" && <PublicActions kind="ota" installHref={`itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`} token={token} appName={v.appName} statusHref={`/d/${token}/install-status?a=${encodeURIComponent(grant)}`} />}
          {action.kind === "external" && <a href={r.build.external_install_url!} rel="noopener noreferrer" className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-center text-[19px] font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>{action.label}</a>}
          {action.kind === "download" && <PublicActions kind="download" installHref={`/d/${token}/download?a=${encodeURIComponent(grant)}`} token={token} />}
          {action.kind === "none" && <p className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-[14px]">No install button is shown: {action.reason}</p>}
        </div>
        <p className="mt-3 text-left text-xs text-[var(--text-3)]">{action.reason} Opening this page or starting a download does not guarantee installation — Apple&apos;s signing, provisioning and device registration rules always apply.{adHoc && " Your device must be registered in the build's provisioning profile."}</p>
      </section>
      <dl className="card divide-y divide-[var(--border)] overflow-hidden">
        <Row k="Released" v={v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : "—"} />
        <Row k="Size" v={fmtBytes(v.fileSizeBytes)} />
        <Row k="Requires" v={v.minimumOS ? `iOS ${v.minimumOS}+` : "—"} />
        <Row k="Method" v={(v.profileType ?? v.distributionMethod).replace(/_/g, " ")} />
        <Row k="Available until" v={v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : "No expiry"} />
      </dl>
      <div className={`rounded-2xl px-4 py-3 text-[14px] ${eligTone === "good" ? "bg-[var(--good-soft)]" : eligTone === "bad" ? "bg-[var(--bad-soft)]" : "bg-[var(--warn-soft)]"}`}>
        <p className="font-semibold">{v.eligibility === "eligible" ? "Eligible for installation" : v.eligibility === "eligible_with_warnings" ? "Eligible, with conditions" : v.eligibility === "not_eligible" ? "Not eligible for installation" : "Needs review"}</p>
        {v.warnings.length > 0 && <ul className="mt-1 list-disc pl-5">{v.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </div>
    </>
  );
  const hasNotes = !!(v.releaseNotes || v.installationGuidance || v.qaInstructions);
  const notes = (
    <div className="card space-y-5 p-5 text-[15px]">
      {v.releaseNotes && <div><h2 className="text-lg font-semibold">What&apos;s new</h2><p className="mt-1 whitespace-pre-wrap text-[var(--text-2)]">{v.releaseNotes}</p></div>}
      {v.installationGuidance && <div><h2 className="text-lg font-semibold">Installation</h2><p className="mt-1 whitespace-pre-wrap text-[var(--text-2)]">{v.installationGuidance}</p></div>}
      {v.qaInstructions && <div><h2 className="text-lg font-semibold">What to test</h2><p className="mt-1 whitespace-pre-wrap text-[var(--text-2)]">{v.qaInstructions}</p></div>}
    </div>
  );
  const feedbackHref = r.user ? `/portal/feedback/new?projectId=${v.projectId}&buildId=${v.buildId}` : `/auth/login?next=${encodeURIComponent(`/d/${token}`)}`;
  const feedback = (
    <div className="card space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Found a problem?</h2>
      <p className="text-[var(--text-2)]">Tell the team what went wrong. Screenshots help. {r.user ? "" : "You will be asked to sign in first."}</p>
      <a href={feedbackHref} className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-[17px] font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>Report an issue</a>
    </div>
  );
  const help = (
    <>
      <div className="card space-y-3 p-5 text-[15px]">
        <h2 className="text-lg font-semibold">How to install</h2>
        <ol className="list-decimal space-y-2 pl-5 text-[var(--text-2)]">
          <li>Open this page in <b>Safari</b> on your iPhone or iPad.</li>
          <li>Tap <b>Install</b>, then <b>Install</b> again when iOS asks.</li>
          <li>Go to your Home Screen. The app appears and finishes installing in a few seconds.</li>
          <li>Open it. If iOS asks about trusting the developer, see Settings → General → VPN &amp; Device Management.</li>
        </ol>
      </div>
      <div className="card space-y-3 p-5 text-[15px]">
        <h2 className="text-lg font-semibold">It says &ldquo;Unable to install&rdquo;?</h2>
        <p className="text-[var(--text-2)]">The most common reason is that your device is not registered for this build yet. Send the team your device ID (they can share a one-tap link for it), then install the newer build they send you.</p>
      </div>
    </>
  );
  const tabs: FrameTab[] = [{ id: "install", label: "Install", icon: "install", content: install }];
  if (hasNotes) tabs.push({ id: "notes", label: "What's new", icon: "notes", content: notes });
  if (v.allowFeedback) tabs.push({ id: "feedback", label: "Report", icon: "feedback", content: feedback });
  tabs.push({ id: "help", label: "Help", icon: "help", content: help });
  return <AppFrame title={v.appName} tabs={tabs} />;
}
