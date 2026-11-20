"use client";
import * as React from "react";
import { PageHeader, Card, Select, FormField, EmptyState } from "@/components/ui";
import { Async, useApi, FeedbackForm } from "@/components/features";

export default function NewFeedback() {
  const sp = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const projects = useApi<{ items: { id: string; name: string; feedback_enabled?: number }[] }>(["projects", "portal"], "/projects?pageSize=100");
  const [pid, setPid] = React.useState(sp.get("projectId") ?? "");
  const id = pid || projects.data?.items[0]?.id || "";
  const builds = useApi<{ items: { id: string; version: string | null; build_number: string | null }[] }>(["pbuilds", id], id ? `/projects/${id}/builds?pageSize=50` : null);
  return (<><PageHeader title="Report an issue" breadcrumbs={[{ label: "Feedback", href: "/portal/feedback" }, { label: "New" }]} />
    <Async q={projects}>{(p) => !p.items.length ? <Card><EmptyState title="No projects" /></Card> : (<Card className="max-w-3xl">
      {p.items.length > 1 && <div className="mb-4"><FormField label="Project" htmlFor="np"><Select id="np" value={id} onChange={(e) => setPid(e.target.value)}>{p.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField></div>}
      <FeedbackForm key={id} projectId={id} builds={builds.data?.items ?? []} defaultBuildId={sp.get("buildId") ?? undefined} onDone={(fid) => { location.href = `/portal/feedback/${fid}`; }} /></Card>)}</Async></>);
}
