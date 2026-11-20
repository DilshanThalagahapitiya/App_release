"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, DataTable, FilterBar, SearchInput, Select, Pagination, EmptyState, StatusBadge, Button } from "@/components/ui";
import { Async, type BuildDto } from "@/components/features";
import { apiFetch, fmtBytes, fmtDay } from "@/lib/client";

export function BuildsTable({ projectId, canUpload = true }: { projectId: string; canUpload?: boolean }) {
  const [q, setQ] = React.useState(""); const [dq, setDq] = React.useState(""); const [validation, setValidation] = React.useState(""); const [eligibility, setEligibility] = React.useState(""); const [publish, setPublish] = React.useState(""); const [page, setPage] = React.useState(1);
  React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", ...(dq && { q: dq }), ...(validation && { validation }), ...(eligibility && { eligibility }), ...(publish && { publish }) }).toString();
  const res = useQuery({ queryKey: ["builds", projectId, qs], queryFn: () => apiFetch<{ items: BuildDto[]; page: number; pageSize: number; total: number }>(`/projects/${projectId}/builds?${qs}`), placeholderData: (p) => p, refetchInterval: 15000 });
  const f = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { set(e.target.value); setPage(1); };
  const filtered = !!(dq || validation || eligibility || publish);
  return (
    <Card className="!p-0">
      <FilterBar><SearchInput value={q} onChange={setQ} placeholder="Version, bundle ID, title" />
        <Select aria-label="Validation" className="!w-40" value={validation} onChange={f(setValidation)}><option value="">All validation</option>{["pending", "running", "completed", "failed"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select aria-label="Eligibility" className="!w-48" value={eligibility} onChange={f(setEligibility)}><option value="">All eligibility</option>{["eligible", "eligible_with_warnings", "not_eligible", "needs_review"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
        <Select aria-label="Distribution status" className="!w-44" value={publish} onChange={f(setPublish)}><option value="">All publish states</option>{["unpublished", "published", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></FilterBar>
      <Async q={res}>{(d) => (<><DataTable rows={d.items} caption="Builds" onRowHref={(b) => `/app/builds/${b.id}`}
        empty={<EmptyState title={filtered ? "No builds match your filters" : "No builds uploaded"} body={filtered ? "Clear the filters to see all builds." : "Upload a signed IPA to get started."} action={!filtered && canUpload ? <a href={`/app/projects/${projectId}/builds/upload`}><Button variant="primary">Upload build</Button></a> : undefined} />}
        cols={[{ key: "v", header: "Version", cell: (b) => `${b.version ?? "—"} (${b.build_number ?? "—"})` }, { key: "t", header: "Title", cell: (b) => b.release_title ?? b.original_filename, hideOnMobile: true }, { key: "val", header: "Validation", cell: (b) => <StatusBadge status={b.validation_status} /> }, { key: "el", header: "Eligibility", cell: (b) => <StatusBadge status={b.eligibility_status} /> }, { key: "p", header: "Status", cell: (b) => <StatusBadge status={b.publish_status} /> }, { key: "s", header: "Size", cell: (b) => fmtBytes(b.file_size_bytes), hideOnMobile: true }, { key: "d", header: "Uploaded", cell: (b) => fmtDay(b.uploaded_at), hideOnMobile: true }]} />
        <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></>)}</Async>
    </Card>
  );
}
