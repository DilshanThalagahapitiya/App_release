"use client";
import { useParams } from "next/navigation";
import { Card, StatCard, KV, Callout, Button } from "@/components/ui";
import { Async, useApi } from "@/components/features";

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useApi<{ description: string | null; app_display_name: string | null; expected_bundle_identifier: string | null; default_qa_instructions: string | null; access_policy: string; stats: { builds: number; published: number; members: number; open_feedback: number } }>(["project", projectId], `/projects/${projectId}`);
  return (<Async q={q}>{(p) => (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-4"><StatCard label="Builds" value={p.stats.builds} /><StatCard label="Published" value={p.stats.published} /><StatCard label="Members" value={p.stats.members} /><StatCard label="Open feedback" value={p.stats.open_feedback} /></div>
      <Card title="Details" actions={<a href={`/app/projects/${projectId}/builds/upload`}><Button variant="primary" size="sm">Upload build</Button></a>}>
        <KV items={[["App display name", p.app_display_name], ["Expected bundle ID", p.expected_bundle_identifier], ["Access policy", p.access_policy === "named_users_only" ? "Signed-in members only" : "Protected links allowed"], ["Description", p.description], ["Default QA instructions", p.default_qa_instructions]]} />
      </Card>
      {p.stats.builds === 0 && <Callout tone="info">No builds yet. Upload an already-signed IPA — the macOS worker will inspect it and report eligibility honestly.</Callout>}
    </div>)}</Async>);
}
