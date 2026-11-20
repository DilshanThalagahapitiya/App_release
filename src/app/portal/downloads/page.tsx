"use client";
import { PageHeader, Card, DataTable, EmptyState, StatusBadge, Callout } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { fmtDate, label } from "@/lib/client";

export default function Downloads() {
  const q = useApi<{ id: string; event_type: string; created_at: string; version: string | null; build_number: string | null; app_name: string | null; project_name: string }[]>(["portal-dl"], "/portal/downloads");
  return (<><PageHeader title="Downloads" description="Your install and download history." />
    <Callout tone="info">“Install started” and “download started” mean you began the process. Apple doesn&apos;t report whether an installation succeeded.</Callout>
    <div className="mt-4"><Card className="!p-0"><Async q={q}>{(rows) => <DataTable rows={rows} caption="Downloads" empty={<EmptyState title="Nothing downloaded yet" body="Open a build from Available builds to install it." />} cols={[{ key: "b", header: "Build", cell: (r) => `${r.project_name} ${r.version ?? ""} (${r.build_number ?? "?"})` }, { key: "e", header: "Event", cell: (r) => <StatusBadge status="neutral">{r.event_type === "manifest_requested" ? "Install started" : r.event_type === "install_confirmed" ? "You confirmed install" : label(r.event_type)}</StatusBadge> }, { key: "t", header: "When", cell: (r) => fmtDate(r.created_at) }]} />}</Async></Card></div></>);
}
