"use client";
import * as React from "react";

type Prog = { stage: "waiting" | "manifest" | "downloading" | "downloaded"; percent: number };

/** Install button. For over-the-air installs it opens a progress sheet driven by what the server actually sees iOS doing. */
export function PublicActions({ kind, installHref, token, appName, statusHref }: { kind: "ota" | "download"; installHref: string; token: string; appName?: string; statusHref?: string }) {
  const [state, setState] = React.useState<"idle" | "started" | "confirmed">("idle");
  const [err, setErr] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [prog, setProg] = React.useState<Prog>({ stage: "waiting", percent: 0 });
  const [slow, setSlow] = React.useState(false);
  const startedAt = React.useRef(0);
  const sinceRef = React.useRef("");

  React.useEffect(() => {
    if (!open || kind !== "ota" || !statusHref) return;
    let stop = false; let doneAt = 0;
    const tick = async () => {
      try {
        const r = await fetch(`${statusHref}&since=${encodeURIComponent(sinceRef.current)}`, { cache: "no-store" });
        if (r.ok) { const j = (await r.json()) as { data?: Prog }; if (j.data) setProg((p) => (j.data!.stage === "waiting" && p.stage !== "waiting" ? p : j.data!)); if (j.data?.stage === "downloaded" && !doneAt) doneAt = Date.now(); }
      } catch { /* offline for a moment */ }
      setSlow(Date.now() - startedAt.current > 25000);
      if (!stop && !(doneAt && Date.now() - doneAt > 8000) && Date.now() - startedAt.current < 4 * 60000) setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; };
  }, [open, kind, statusHref]);

  const begin = () => { startedAt.current = Date.now(); sinceRef.current = new Date(Date.now() - 2000).toISOString(); setProg({ stage: "waiting", percent: 0 }); setSlow(false); setState("started"); if (kind === "ota") setOpen(true); };
  const overall = prog.stage === "waiting" ? 6 : prog.stage === "manifest" ? 18 : prog.stage === "downloading" ? Math.max(22, 20 + Math.round(prog.percent * 0.7)) : 95;
  const steps: [string, boolean, boolean][] = [
    ["Asking iOS to install", prog.stage !== "waiting", prog.stage === "waiting"],
    ["Confirm in the iOS pop-up (tap Install)", prog.stage === "downloading" || prog.stage === "downloaded", prog.stage === "manifest"],
    ["Downloading to your device", prog.stage === "downloaded", prog.stage === "downloading"],
    ["Installing on your device", false, prog.stage === "downloaded"],
  ];
  const confirm = async () => { const r = await fetch(`/d/${token}/install-confirmed`, { method: "POST" }); if (r.ok) setState("confirmed"); else setErr("Could not record your confirmation."); };
  return (
    <div className="space-y-3">
      <a href={installHref} onClick={begin} className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-center text-[19px] font-semibold shadow-sm active:opacity-80" style={{ color: "var(--accent-text)", textDecoration: "none" }}>{kind === "ota" ? "Install" : "Download IPA"}</a>
      {kind === "download" && state !== "idle" && <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[13px]" role="status">Your download has started. We can&apos;t see whether installation succeeds.</p>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Install progress">
          <div className="safe-b w-full max-w-md rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between"><h2 className="text-[19px] font-bold">{prog.stage === "downloaded" ? "Almost ready" : `Installing ${appName ?? "the app"}`}</h2><button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-[15px] font-medium text-[var(--accent)]">Close</button></div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[var(--accent)] transition-all duration-700" style={{ width: `${overall}%` }} /></div>
            <p className="mt-1 text-right text-[12px] text-[var(--text-3)]">{prog.stage === "downloading" ? `Downloading ${prog.percent}%` : prog.stage === "downloaded" ? "Download complete" : "Waiting…"}</p>
            <ol className="mt-3 space-y-2 text-[15px]">
              {steps.map(([t, done, now], i) => (<li key={i} className={`flex items-center gap-3 ${done ? "text-[var(--good)]" : now ? "font-semibold" : "text-[var(--text-3)]"}`}><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${done ? "bg-[var(--good-soft)]" : now ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)]"}`}>{done ? "✓" : i + 1}</span>{t}</li>))}
            </ol>
            <div className="mt-4 rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-[14px]">
              {prog.stage === "downloaded"
                ? <><p className="font-semibold">Your app will be ready in a moment.</p><p className="mt-0.5 text-[var(--text-2)]">Go to your <b>Home Screen</b> (or <b>App Library</b>) and look for <b>{appName ?? "the app"}</b>. While it installs, its icon shows a progress circle. When the circle disappears, tap the icon to open it.</p></>
                : <p className="text-[var(--text-2)]">When iOS asks <b>&ldquo;Install {appName ?? "the app"}?&rdquo;</b>, tap <b>Install</b>. Then the app downloads in the background. You can leave this page and check your <b>Home Screen / App Library</b> for the app icon.</p>}
            </div>
            {slow && prog.stage === "waiting" && <p className="mt-3 text-[13px] text-[var(--warn)]">Nothing happened yet. Tap Install again. If iOS says <b>&ldquo;Unable to install&rdquo;</b>, your phone is not registered for this build. Ask the team to add your device.</p>}
            {state !== "confirmed" && prog.stage === "downloaded" && <button type="button" className="mt-3 w-full rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-[15px] font-semibold" onClick={confirm}>It&apos;s installed — let the team know</button>}
            {state === "confirmed" && <p className="mt-3 text-center text-[14px]">Thanks — recorded as self-reported.</p>}
            {err && <p className="mt-2 text-[13px] text-[var(--bad)]">{err}</p>}
          </div>
        </div>)}
    </div>
  );
}
export function PasswordForm({ token }: { token: string }) {
  const [pw, setPw] = React.useState(""); const [err, setErr] = React.useState(""); const [busy, setBusy] = React.useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); const r = await fetch(`/d/${token}/access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) }); setBusy(false); if (r.ok) location.reload(); else setErr(((await r.json()) as { error?: { message?: string } }).error?.message ?? "Could not verify the password."); }}>
      <label className="block text-[13px] font-medium" htmlFor="pw">Password</label>
      <input id="pw" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3" />
      {err && <p role="alert" className="text-[13px] text-[var(--bad)]">{err}</p>}
      <button disabled={busy || !pw} className="h-10 w-full rounded-lg bg-[var(--accent)] font-medium text-[var(--accent-text)] disabled:opacity-50">{busy ? "Checking…" : "Continue"}</button>
    </form>
  );
}
