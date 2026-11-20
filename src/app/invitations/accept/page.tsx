"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { Button, Callout, FormField, Input } from "@/components/ui";

function Form() {
  const token = useSearchParams().get("token") ?? "";
  const [name, setName] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [existing, setExisting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await apiFetch<{ signedIn: boolean }>("/auth/accept-invitation", { body: existing ? { token } : { token, displayName: name, password: pw } });
      location.href = r.signedIn ? "/" : "/auth/login";
    } catch (x) {
      const m = (x as Error).message;
      if (m.includes("password are required")) setExisting(false);
      setErr(m);
    } finally { setBusy(false); }
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <h1 className="text-lg font-semibold">Accept your invitation</h1>
      {!token && <Callout tone="bad">This invitation link is missing its token.</Callout>}
      {err && <Callout tone="bad">{err}</Callout>}
      {!existing && (<>
        <FormField label="Your name" htmlFor="n"><Input id="n" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Choose a password" hint="At least 12 characters." htmlFor="p"><Input id="p" type="password" autoComplete="new-password" minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} /></FormField></>)}
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!token}>{existing ? "Join organisation" : "Create account & join"}</Button>
      <button type="button" className="w-full text-center text-[13px] text-[var(--accent)]" onClick={() => setExisting(!existing)}>{existing ? "I'm new — create an account" : "I already have an account"}</button>
    </form>
  );
}
export default function Accept() { return <Suspense><Form /></Suspense>; }
