"use client";
import * as React from "react";
import { PageHeader, Card, DataTable, Button, FilterBar, SearchInput, Select, Pagination, EmptyState, StatusBadge } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { fmtDay } from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/client";

interface P { id: string; name: string; app_display_name: string | null; expected_bundle_identifier: string | null; member_count: number; latest_version: string | null; latest_build_at: string | null; status: string; updated_at: string; my_role: string }
interface Page { items: P[]; page: number; pageSize: number; total: number }
export default function Projects() {
  const [q, setQ] = React.useState(""); const [status, setStatus] = React.useState(""); const [sort, setSort] = React.useState("updated"); const [page, setPage] = React.useState(1);
  const [dq, setDq] = React.useState(""); React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", sort, ...(dq && { q: dq }), ...(status && { status }) }).toString();
  const res = useQuery({ queryKey: ["projects", qs], queryFn: () => apiFetch<Page>(`/projects?${qs}`), placeholderData: (p) => p });
  void useApi;
  return (
    <>
      <PageHeader title="Projects" description="Apps your team distributes and tests." actions={<a href="/app/projects/new"><Button variant="primary">New project</Button></a>} />
      <Card className="!p-0">
        <FilterBar><SearchInput value={q} onChange={setQ} placeholder="Search name or bundle ID" />
          <Select aria-label="Status" className="!w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></Select>
          <Select aria-label="Sort" className="!w-40" value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Recently updated</option><option value="name">Name</option><option value="created">Newest</option></Select></FilterBar>
        <Async q={res}>{(d) => (<><DataTable rows={d.items} caption="Projects" onRowHref={(r) => `/app/projects/${r.id}`}
          empty={<EmptyState title={dq || status ? "No projects match your filters" : "No projects yet"} body={dq || status ? "Try clearing the search or filters." : "Create your first project to upload builds."} action={!dq && !status ? <a href="/app/projects/new"><Button variant="primary">New project</Button></a> : undefined} />}
          cols={[{ key: "n", header: "Project", cell: (r) => r.name }, { key: "a", header: "App", cell: (r) => r.app_display_name ?? "—", hideOnMobile: true }, { key: "b", header: "Bundle ID", cell: (r) => <code className="text-xs">{r.expected_bundle_identifier ?? "—"}</code>, hideOnMobile: true }, { key: "m", header: "Members", cell: (r) => r.member_count }, { key: "l", header: "Latest build", cell: (r) => r.latest_version ?? "—" }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }, { key: "u", header: "Updated", cell: (r) => fmtDay(r.updated_at), hideOnMobile: true }]} />
          <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></>)}</Async>
      </Card>
    </>
  );
}
