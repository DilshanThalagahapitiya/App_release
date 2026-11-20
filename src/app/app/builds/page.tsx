"use client";
import * as React from "react";
import { PageHeader, Select, EmptyState, Card } from "@/components/ui";
import { useApi } from "@/components/features";
import { BuildsTable } from "@/components/builds-table";

export default function AllBuilds() {
  const projects = useApi<{ items: { id: string; name: string }[] }>(["projects", "all"], "/projects?pageSize=100");
  const [sel, setSel] = React.useState("");
  const id = sel || projects.data?.items[0]?.id;
  return (<>
    <PageHeader title="Builds" actions={projects.data && projects.data.items.length > 0 && <Select aria-label="Project" className="!w-56" value={id ?? ""} onChange={(e) => setSel(e.target.value)}>{projects.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>} />
    {id ? <BuildsTable projectId={id} /> : projects.isLoading ? null : <Card><EmptyState title="No projects yet" body="Create a project before uploading builds." /></Card>}
  </>);
}
