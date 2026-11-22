"use client";
import * as React from "react";

export function PublicActions({ kind, installHref, token }: { kind: "ota" | "download"; installHref: string; token: string }) {
  const [state, setState] = React.useState<"idle" | "started" | "confirmed">("idle");
  const [err, setErr] = React.useState("");
  return (
    <div className="space-y-3">
      <a href={installHref} onClick={() => setState("started")} className="block rounded-2xl bg-[var(--accent)] px-4 py-4 text-center text-[19px] font-semibold shadow-sm active:opacity-80" style={{ color: "var(--accent-text)", textDecoration: "none" }}>{kind === "ota" ? "Install" : "Download IPA"}</a>
      {state !== "idle" && (
        <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-[13px]" role="status">
          {state === "started" ? (<><p>{kind === "ota" ? "iOS will ask for permission to install. If nothing happens, this build may not be provisioned for your device." : "Your download has started."} We can&apos;t see whether installation succeeds.</p>
            <button className="mt-2 font-medium text-[var(--accent)]" onClick={async () => { const r = await fetch(`/d/${token}/install-confirmed`, { method: "POST" }); if (r.ok) setState("confirmed"); else setErr("Could not record your confirmation."); }}>It&apos;s installed — let the team know</button></>) : <p>Thanks — recorded as self-reported.</p>}
          {err && <p className="text-[var(--bad)]">{err}</p>}
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
