"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { Button, Callout, FormField, Input } from "@/components/ui";

function Form() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState(""); const [done, setDone] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await apiFetch("/auth/reset-password", { body: { token, password: pw } }); setDone(true); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      {!token && <Callout tone="bad">This reset link is missing its token.</Callout>}
      {done ? <Callout tone="good">Password updated. All existing sessions were signed out. <a href="/auth/login">Sign in</a></Callout> : (<>
        {err && <Callout tone="bad">{err}</Callout>}
        <FormField label="New password" hint="At least 12 characters." htmlFor="p"><Input id="p" type="password" autoComplete="new-password" minLength={12} required value={pw} onChange={(e) => setPw(e.target.value)} /></FormField>
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!token}>Update password</Button></>)}
    </form>
  );
}
export default function ResetPage() { return <Suspense><Form /></Suspense>; }
