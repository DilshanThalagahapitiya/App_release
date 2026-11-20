"use client";
import { PageHeader, Card, KV, Button } from "@/components/ui";
import { Async, useApi, useAct } from "@/components/features";
import { apiFetch, label } from "@/lib/client";
import type { Me } from "@/components/shell";

export default function Profile() {
  const q = useApi<Me>(["me"], "/auth/me");
  const out = useAct(() => apiFetch("/auth/logout", { method: "POST" }), { onSuccess: () => { location.href = "/auth/login"; } });
  return (<><PageHeader title="Profile & account" /><Async q={q}>{(m) => (<div className="max-w-2xl space-y-5">
    <Card title="Your account"><KV items={[["Name", m.displayName], ["Email", m.email], ["Organisations", m.memberships.map((x) => `${x.name} (${label(x.role)})`).join(", ")]]} /></Card>
    <Card title="Security"><p className="mb-3 text-[13px] text-[var(--text-2)]">To change your password use the reset flow; it signs out every other session.</p><div className="flex gap-2"><a href="/auth/forgot-password"><Button>Reset password</Button></a><Button onClick={() => out.mutate()}>Sign out</Button></div></Card></div>)}</Async></>);
}
