"use client";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { fmtDay } from "@/lib/client";

export default function MyProjects() {
  const q = useApi<{ items: { id: string; name: string; app_display_name: string | null; latest_version: string | null; latest_build_at: string | null; status: string }[] }>(["projects", "portal"], "/projects?pageSize=100");
  return (<><PageHeader title="My projects" description="Apps you've been given access to test." />
    <Async q={q}>{(d) => d.items.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.items.map((p) => (<a key={p.id} href={`/portal/builds?project=${p.id}`} className="card block p-4" style={{ color: "var(--text)", textDecoration: "none" }}><div className="flex items-start justify-between"><h2 className="font-semibold">{p.name}</h2><StatusBadge status={p.status} /></div><p className="mt-1 text-[13px] text-[var(--text-2)]">{p.app_display_name}</p><p className="mt-3 text-xs muted">{p.latest_version ? `Latest ${p.latest_version} · ${fmtDay(p.latest_build_at)}` : "No builds yet"}</p></a>))}</div> : <Card><EmptyState title="No projects yet" body="You'll see projects here after an administrator gives you access. Check your email for an invitation." /></Card>}</Async></>);
}
