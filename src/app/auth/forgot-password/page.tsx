"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { Button, Callout, FormField, Input } from "@/components/ui";

export default function Forgot() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await apiFetch("/auth/forgot-password", { body: { email } }); setDone(true); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
      <h1 className="text-lg font-semibold">Reset your password</h1>
      {done ? <Callout tone="good">If an account exists for that address and email delivery is configured, a reset link is on its way. The link expires in 1 hour.</Callout> : (<>
        {err && <Callout tone="bad">{err}</Callout>}
        <FormField label="Email" htmlFor="e"><Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Send reset link</Button></>)}
      <p className="text-center text-[13px]"><a href="/auth/login">Back to sign in</a></p>
    </form>
  );
}
