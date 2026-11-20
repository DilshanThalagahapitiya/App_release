"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, DataTable, StatusBadge, EmptyState, Callout, Button } from "@/components/ui";
import { Async, useApi, useAct, ValidationSummary, PipelineStages, type ReportDto } from "@/components/features";
import { apiFetch, fmtDate } from "@/lib/client";

interface Hist { jobs: { id: string; status: string; attempt_count: number; max_attempts: number; error_code: string | null; error_message: string | null; created_at: string; completed_at: string | null }[]; reports: (ReportDto & { id: string; attempt: number })[] }
export default function ValidationPage() {
  const { buildId } = useParams<{ buildId: string }>();
  const v = useApi<{ validation_status: string; eligibility_status: string; processing_status: string; report: ReportDto | null }>(["validation", buildId], `/builds/${buildId}/validation`, { refetchInterval: 4000 });
  const h = useApi<Hist>(["vhist", buildId], `/builds/${buildId}/validation/history`);
  const raw = useAct(() => apiFetch<{ url: string }>(`/builds/${buildId}/report`, { method: "POST" }), { onSuccess: (r) => window.open(r.url, "_blank", "noopener") });
  return (<div className="space-y-5">
    <Async q={v}>{(d) => (<>
      {!d.report && <Card title="Processing"><PipelineStages b={d} /><p className="mt-3 text-xs muted">The page refreshes automatically. Nothing is marked validated until the worker's report has been stored.</p></Card>}
      {d.report && <><div className="flex justify-end"><Button size="sm" loading={raw.isPending} onClick={() => raw.mutate()}>Download raw report (JSON)</Button></div><ValidationSummary report={d.report} />
        {d.report.warnings.length > 0 && <Callout tone="warn" title="Warnings">{d.report.warnings.map((w, i) => <p key={i}>{w}</p>)}</Callout>}</>}
    </>)}</Async>
    <Card title="Validation history" className="!p-0"><Async q={h}>{(d) => <DataTable rows={d.jobs} caption="Validation jobs" empty={<EmptyState title="No jobs yet" />} cols={[{ key: "t", header: "Queued", cell: (j) => fmtDate(j.created_at) }, { key: "s", header: "Status", cell: (j) => <StatusBadge status={j.status} /> }, { key: "a", header: "Attempts", cell: (j) => `${j.attempt_count}/${j.max_attempts}` }, { key: "e", header: "Result", cell: (j) => j.error_message ? <span className="text-[var(--bad)]">{j.error_code}: {j.error_message}</span> : j.completed_at ? fmtDate(j.completed_at) : "—" }]} />}</Async></Card>
  </div>);
}
