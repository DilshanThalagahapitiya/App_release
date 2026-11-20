"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, DataTable, FilterBar, SearchInput, Select, Pagination, EmptyState, StatusBadge } from "./ui";
import { Async, CATEGORIES } from "./features";
import { apiFetch, ago, label } from "@/lib/client";

interface Row { id: string; project_name: string; title: string; category: string; severity: string; status: string; version: string | null; build_number: string | null; reporter_name: string | null; assignee_name: string | null; created_at: string }
export function FeedbackTable({ projectId, base, showReporter = true }: { projectId?: string; base: string; showReporter?: boolean }) {
  const [q, setQ] = React.useState(""); const [dq, setDq] = React.useState(""); const [status, setStatus] = React.useState(""); const [severity, setSeverity] = React.useState(""); const [category, setCategory] = React.useState(""); const [page, setPage] = React.useState(1);
  React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", sort: "created", ...(dq && { q: dq }), ...(status && { status }), ...(severity && { severity }), ...(category && { category }), ...(projectId && { projectId }) }).toString();
  const res = useQuery({ queryKey: ["feedback", qs], queryFn: () => apiFetch<{ items: Row[]; page: number; pageSize: number; total: number }>(`/feedback?${qs}`), placeholderData: (p) => p, refetchInterval: 30000 });
  const f = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { set(e.target.value); setPage(1); };
  const filtered = !!(dq || status || severity || category);
  return (
    <Card className="!p-0">
      <FilterBar><SearchInput value={q} onChange={setQ} placeholder="Search feedback" />
        <Select aria-label="Status" className="!w-40" value={status} onChange={f(setStatus)}><option value="">All statuses</option>{["new", "triaged", "in_progress", "need_more_info", "resolved", "closed"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Severity" className="!w-36" value={severity} onChange={f(setSeverity)}><option value="">All severities</option>{["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Category" className="!w-40" value={category} onChange={f(setCategory)}><option value="">All categories</option>{CATEGORIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></FilterBar>
      <Async q={res}>{(d) => (<><DataTable rows={d.items} caption="Feedback" onRowHref={(r) => `${base}/${r.id}`}
        empty={<EmptyState title={filtered ? "No feedback matches your filters" : "No feedback yet"} body={filtered ? "Clear filters to see everything." : "Reports from testers appear here."} />}
        cols={[{ key: "t", header: "Title", cell: (r) => r.title }, { key: "p", header: "Project", cell: (r) => r.project_name, hideOnMobile: true }, { key: "b", header: "Build", cell: (r) => r.version ? `${r.version} (${r.build_number ?? "?"})` : "—", hideOnMobile: true }, { key: "c", header: "Category", cell: (r) => label(r.category), hideOnMobile: true }, { key: "sev", header: "Severity", cell: (r) => <StatusBadge status={r.severity} /> }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }, ...(showReporter ? [{ key: "r", header: "Reporter", cell: (r: Row) => r.reporter_name ?? "—", hideOnMobile: true }, { key: "a", header: "Owner", cell: (r: Row) => r.assignee_name ?? "Unassigned", hideOnMobile: true }] : []), { key: "d", header: "Created", cell: (r) => ago(r.created_at) }]} />
        <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></>)}</Async>
    </Card>
  );
}
