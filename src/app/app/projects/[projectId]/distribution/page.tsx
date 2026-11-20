"use client";
import { useParams } from "next/navigation";
import { Card, Callout, KV } from "@/components/ui";
import { Async, useApi, DistributionLinkCard, type LinkDto } from "@/components/features";
import { EmptyState } from "@/components/ui";

export default function ProjectDistribution() {
  const { projectId } = useParams<{ projectId: string }>();
  const p = useApi<{ access_policy: string; default_install_instructions: string | null }>(["project", projectId], `/projects/${projectId}`);
  const links = useApi<(LinkDto & { version: string | null; build_number: string | null })[]>(["plinks", projectId], `/distribution-links?projectId=${projectId}`);
  return (<div className="space-y-5">
    <Async q={p}>{(d) => <Card title="Distribution policy"><KV items={[["Customer access", d.access_policy === "named_users_only" ? "Signed-in members only — protected links are blocked" : "Protected links allowed (optionally password-protected)"], ["Default install instructions", d.default_install_instructions]]} /><p className="mt-3 text-xs muted">Change these in Settings. Links are created from a published build.</p></Card>}</Async>
    <Callout tone="info">Links never bypass Apple's rules: installation still requires a suitably signed build and, for Ad Hoc, a device registered in the provisioning profile.</Callout>
    <Async q={links}>{(rows) => rows.length ? <div className="space-y-3">{rows.map((l) => <DistributionLinkCard key={l.id} l={l} />)}</div> : <Card><EmptyState title="No distribution links" body="Open a published build and create a link." /></Card>}</Async>
  </div>);
}
