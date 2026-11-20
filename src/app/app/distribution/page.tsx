"use client";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { Async, useApi, DistributionLinkCard, type LinkDto } from "@/components/features";
export default function Distribution() {
  const q = useApi<(LinkDto & { project_name: string; version: string | null; build_number: string | null })[]>(["links", "all"], "/distribution-links");
  return (<><PageHeader title="Distribution" description="All distribution links you manage. Create links from a published build." />
    <Async q={q}>{(rows) => rows.length ? <div className="space-y-3">{rows.map((l) => <div key={l.id}><p className="mb-1 text-xs muted">{l.project_name} · {l.version ?? "?"} ({l.build_number ?? "?"})</p><DistributionLinkCard l={l} /></div>)}</div> : <Card><EmptyState title="No distribution links" body="Publish a build, then create a link from its Distribution tab." /></Card>}</Async></>);
}
