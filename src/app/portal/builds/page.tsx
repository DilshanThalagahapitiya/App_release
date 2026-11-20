"use client";
import { PageHeader, Card, EmptyState, StatusBadge, Button } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { fmtDay } from "@/lib/client";

export interface PB { link_id: string; path: string; project_id: string; project_name: string; app_name: string | null; version: string | null; build_number: string | null; eligibility_status: string; published_at: string | null; release_title: string | null; expires_at: string | null }
export default function AvailableBuilds() {
  const q = useApi<PB[]>(["portal-builds"], "/portal/builds");
  return (<><PageHeader title="Available builds" description="Builds shared with you. Open one to see install instructions." />
    <Async q={q}>{(rows) => rows.length ? <div className="space-y-3">{rows.map((b) => (<div key={b.link_id} className="card flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{b.project_name} · {b.app_name ?? ""} {b.version} ({b.build_number})</p><p className="mt-0.5 text-xs muted">{b.release_title ? `${b.release_title} · ` : ""}Published {fmtDay(b.published_at)}{b.expires_at ? ` · available until ${fmtDay(b.expires_at)}` : ""}</p><div className="mt-1"><StatusBadge status={b.eligibility_status} /></div></div><a href={b.path}><Button variant="primary">Open</Button></a></div>))}</div> : <Card><EmptyState title="No builds available" body="When an administrator shares a build with you it will appear here." /></Card>}</Async></>);
}
