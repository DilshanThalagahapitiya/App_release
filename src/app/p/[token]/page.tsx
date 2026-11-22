import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { logEvent, resolveLink } from "@/services/distribution";
import { previewPublicView } from "@/services/simulator";
import { PasswordForm } from "../../d/[token]/client";
import { PreviewEmbed } from "./client";
import { AppFrame, type FrameTab } from "@/components/app-frame";

export const metadata = { title: "Interactive preview", robots: { index: false, follow: false } };

const Single = ({ children }: { children: React.ReactNode }) => <AppFrame title="Crede Releases" tabs={[{ id: "x", label: "", icon: "preview", content: children }]} />;
function Notice({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (<Single><div className="card space-y-3 p-6 text-center"><h2 className="text-lg font-semibold">{title}</h2><p className="text-[var(--text-2)]">{body}</p>{href && <a href={href} className="inline-block rounded-2xl bg-[var(--accent)] px-6 py-3 text-[17px] font-semibold" style={{ textDecoration: "none", color: "var(--accent-text)" }}>{cta}</a>}</div></Single>);
}

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const env = await getEnv();
  const h = await headers();
  const req = new Request(`${env.APP_URL}/p/${token}`, { headers: { cookie: h.get("cookie") ?? "", "user-agent": h.get("user-agent") ?? "", "cf-connecting-ip": h.get("cf-connecting-ip") ?? "" } });
  let r;
  try { r = await resolveLink(env, req, token); }
  catch (e) { if (e instanceof ApiError) return <Notice title="Link not found" body="This link doesn't exist or has been removed. Check that you copied it completely." />; throw e; }
  if (r.link.kind !== "preview") redirect(`/d/${token}`);

  if (r.access === "unavailable") return <Notice title={r.state === "revoked" ? "This preview link was turned off" : r.state === "expired" ? "This preview link has expired" : "This preview is no longer available"} body="Ask the person who shared it with you for a new link." />;
  if (r.access === "login_required") return <Notice title="Sign in to continue" body="This preview was shared with specific people. Sign in with the account you were invited with." href={`/auth/login?next=${encodeURIComponent(`/p/${token}`)}`} cta="Sign in" />;
  if (r.access === "denied") return <Notice title="You don't have access" body={r.reason ?? "This link was not shared with your account."} />;
  if (r.access === "password_required") return (<Single><div className="card space-y-3 p-6"><h2 className="text-lg font-semibold">Password required</h2><p className="text-[var(--text-2)]">Enter the password you were given with this link.</p><PasswordForm token={token} base="/p" /></div></Single>);

  await logEvent(env, r, req, "page_open");
  const view = await previewPublicView(env, r.build.id);
  const appName = r.build.app_name ?? r.project.app_display_name ?? r.project.name;
  const notes = r.link.customer_release_notes ?? r.build.release_notes;

  const preview = (
    <>
      {r.staffPreview && <div className="rounded-xl bg-[var(--info-soft)] px-4 py-2.5 text-[13px]">Staff preview — what your client will see.</div>}
      <section className="card flex items-center gap-4 p-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4f9bff] to-[#1f5fd1] text-2xl font-bold text-white shadow-md" aria-hidden>{appName.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0"><h2 className="truncate text-xl font-bold tracking-tight">{appName}</h2><p className="text-[14px] text-[var(--text-2)]">Version {r.build.version ?? "?"} ({r.build.build_number ?? "?"})</p><p className="truncate text-[13px] text-[var(--text-3)]">{r.org.name} · {r.project.name}</p></div>
      </section>
      {view.available
        ? (view.display === "embed" ? <PreviewEmbed src={view.embedUrl} appName={appName} /> : (
          <section className="card space-y-4 p-6 text-center">
            <h2 className="text-xl font-semibold">Try the app in your browser</h2>
            <p className="text-[var(--text-2)]">This opens a real iPhone simulator in a new tab. Tap <b>Tap to Start</b>, then use the app like normal. Nothing is installed.</p>
            <a href={view.openUrl} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-[17px] font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>Open interactive preview</a>
            <p className="text-xs text-[var(--text-3)]">It opens on appetize.io, which hosts the simulator.</p>
          </section>))
        : <div className="card space-y-2 p-6 text-center" role="status"><h2 className="text-lg font-semibold">Preview not available</h2><p className="text-[var(--text-2)]">{view.reason}</p></div>}
    </>
  );
  const notesTab = (
    <div className="card space-y-3 p-5 text-[15px]">
      <h2 className="text-lg font-semibold">What&apos;s new</h2>
      {notes ? <p className="whitespace-pre-wrap text-[var(--text-2)]">{notes}</p> : <p className="text-[var(--text-2)]">No release notes were provided for this version.</p>}
      {r.project.default_qa_instructions && <><h2 className="pt-2 text-lg font-semibold">What to test</h2><p className="whitespace-pre-wrap text-[var(--text-2)]">{r.project.default_qa_instructions}</p></>}
    </div>
  );
  const feedbackHref = r.user ? `/portal/feedback/new?projectId=${r.project.id}&buildId=${r.build.id}` : `/auth/login?next=${encodeURIComponent(`/p/${token}`)}`;
  const feedback = (
    <div className="card space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Found a problem or have a comment?</h2>
      <p className="text-[var(--text-2)]">Tell the team what you noticed in version {r.build.version ?? "?"}. Screenshots help. {r.user ? "" : "You will be asked to sign in first."}</p>
      <a href={feedbackHref} className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-[17px] font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>Send feedback</a>
    </div>
  );
  const help = (
    <div className="card space-y-3 p-5 text-[15px]">
      <h2 className="text-lg font-semibold">How to use the preview</h2>
      <ol className="list-decimal space-y-2 pl-5 text-[var(--text-2)]">
        <li>Open the <b>Preview</b> tab and tap the phone screen to start.</li>
        <li>Use it like a real iPhone: tap, scroll and type. Nothing is installed on your device.</li>
        <li>Use <b>Full screen</b> for a bigger view where your browser supports it.</li>
        <li>Sessions end after a few minutes of inactivity. Tap the screen again to restart.</li>
      </ol>
      <p className="text-[var(--text-2)]">This runs in a cloud simulator, so it can differ slightly from a real device (for example camera, Face ID and notifications).</p>
    </div>
  );
  const tabs: FrameTab[] = [{ id: "preview", label: "Preview", icon: "preview", content: preview }, { id: "notes", label: "What's new", icon: "notes", content: notesTab }];
  if (r.link.allow_feedback && r.project.feedback_enabled) tabs.push({ id: "feedback", label: "Feedback", icon: "feedback", content: feedback });
  tabs.push({ id: "help", label: "Help", icon: "help", content: help });
  return <AppFrame title={appName} tabs={tabs} />;
}
