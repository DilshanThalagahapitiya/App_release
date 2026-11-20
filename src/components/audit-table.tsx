"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, DataTable, FilterBar, Input, Select, Pagination, EmptyState, Button } from "./ui";
import { Async } from "./features";
import { apiFetch, fmtDate } from "@/lib/client";

interface Row { id: string; action: string; actor_name: string | null; actor_type: string; resource_type: string | null; resource_id: string | null; metadata_json: string | null; created_at: string }
export function AuditTable() {
  const [action, setAction] = React.useState(""); const [rt, setRt] = React.useState(""); const [from, setFrom] = React.useState(""); const [page, setPage] = React.useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "25", ...(action && { action }), ...(rt && { resourceType: rt }), ...(from && { from: new Date(from).toISOString() }) }).toString();
  const res = useQuery({ queryKey: ["audit", qs], queryFn: () => apiFetch<{ items: Row[]; page: number; pageSize: number; total: number }>(`/audit-logs?${qs}`), placeholderData: (p) => p });
  return (
    <Card className="!p-0">
      <FilterBar><Input aria-label="Action prefix" className="!w-48" placeholder="Action, e.g. build." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        <Select aria-label="Resource" className="!w-44" value={rt} onChange={(e) => { setRt(e.target.value); setPage(1); }}><option value="">All resources</option>{["organisation", "project", "build", "distribution_link", "feedback", "member", "invitation", "worker", "job", "user", "upload_session"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Input aria-label="Since" type="date" className="!w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <a className="ml-auto" href={`/api/v1/audit-logs?format=csv&${qs}`}><Button size="sm">Export CSV</Button></a></FilterBar>
      <Async q={res}>{(d) => (<><DataTable rows={d.items} caption="Audit log" empty={<EmptyState title="No matching activity" body="Privileged actions, sign-ins and distribution events are recorded here." />}
        cols={[{ key: "t", header: "When", cell: (r) => fmtDate(r.created_at) }, { key: "a", header: "Action", cell: (r) => <code className="text-xs">{r.action}</code> }, { key: "w", header: "Actor", cell: (r) => r.actor_name ?? r.actor_type }, { key: "r", header: "Resource", cell: (r) => r.resource_type ? `${r.resource_type} ${r.resource_id?.slice(0, 8) ?? ""}` : "—", hideOnMobile: true }, { key: "m", header: "Details", cell: (r) => <span className="text-xs muted">{r.metadata_json?.slice(0, 80) ?? ""}</span>, hideOnMobile: true }]} />
        <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></>)}</Async>
    </Card>
  );
}
