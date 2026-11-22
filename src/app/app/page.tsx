"use client";
import { PageHeader, StatCard, Card, DataTable, EmptyState, StatusBadge, Callout } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { BarChart, HBars } from "@/components/charts";
import { ago, label } from "@/lib/client";

interface Overview { empty: boolean; validationMode?: "on" | "cloud" | "off"; totals: Record<string, number>; downloadsByDay: { day: string; count: number }[]; feedbackBySeverity: { severity: string; count: number }[]; buildsByEligibility: { status: string; count: number }[]; recentDownloads: { id: string; event_type: string; created_at: string; project_name: string; version: string | null; build_number: string | null; user_name: string | null; user_agent_summary: string }[]; recentActivity: { id: string; action: string; actor_name: string | null; created_at: string }[]; processing: { queued: number; running: number; failed: number; avgProcessingMs: number | null; workersOnline: number } | null }

export default function OverviewPage() {
  const q = useApi<Overview>(["overview"], "/overview", { refetchInterval: 30000 });
  return (
    <>
      <PageHeader title="Overview" description="Live status of your projects, builds and QA feedback." />
      <Async q={q} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>}>{(d) => d.empty ? (
        <Card><EmptyState title="No projects yet" body="Create a project to start uploading builds. Metrics appear here once there is real activity." action={<a href="/app/projects/new"><span className="rounded-lg bg-[var(--accent)] px-3.5 py-2 font-medium text-[var(--accent-text)]">Create a project</span></a>} /></Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Projects" value={d.totals.projects} href="/app/projects" /><StatCard label="Total builds" value={d.totals.builds} /><StatCard label="Published builds" value={d.totals.publishedBuilds} />
            <StatCard label="Awaiting validation" value={d.totals.awaitingValidation} /><StatCard label="Failed validations" value={d.totals.failedValidation} /><StatCard label="Active testers / customers" value={d.totals.activeUsers} />
            <StatCard label="Open feedback" value={d.totals.openFeedback} href="/app/feedback" />
            {d.validationMode && d.validationMode !== "on" ? <StatCard label="Validation" value={d.validationMode === "cloud" ? "Cloud check" : "Off"} hint={d.validationMode === "cloud" ? "No Mac needed" : "Uploads are not inspected"} href="/app/settings" /> : d.processing ? <StatCard label="Worker status" value={d.processing.workersOnline > 0 ? "Online" : "Offline"} hint={`${d.processing.queued} queued · ${d.processing.running} running`} href="/app/workers" /> : <StatCard label="Worker status" value="—" hint="Visible to the Platform Owner" />}
          </div>
          {d.validationMode === "on" && d.processing && d.processing.workersOnline === 0 && d.processing.queued > 0 && <Callout tone="warn" title="No worker online">{d.processing.queued} build(s) are waiting for validation but no macOS worker has sent a heartbeat recently.</Callout>}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><BarChart title="Downloads & install starts, last 30 days" data={d.downloadsByDay.map((x) => ({ label: x.day, value: x.count }))} emptyText="No downloads yet. Events appear when someone uses a distribution link." /></div>
            <HBars title="Open feedback by severity" data={["critical", "high", "medium", "low"].map((s) => ({ label: label(s), value: d.feedbackBySeverity.find((x) => x.severity === s)?.count ?? 0 }))} emptyText="No open feedback." />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Recent downloads"><DataTable caption="Recent downloads" rows={d.recentDownloads} empty={<EmptyState title="No downloads yet" />} cols={[{ key: "p", header: "Project / build", cell: (r) => `${r.project_name} ${r.version ?? ""} (${r.build_number ?? "?"})` }, { key: "e", header: "Event", cell: (r) => <StatusBadge status="neutral">{label(r.event_type)}</StatusBadge> }, { key: "u", header: "By", cell: (r) => r.user_name ?? r.user_agent_summary, hideOnMobile: true }, { key: "t", header: "When", cell: (r) => ago(r.created_at) }]} /></Card>
            <Card title="Recent activity"><DataTable caption="Recent activity" rows={d.recentActivity} empty={<EmptyState title="No activity yet" />} cols={[{ key: "a", header: "Action", cell: (r) => r.action }, { key: "w", header: "Who", cell: (r) => r.actor_name ?? "System" }, { key: "t", header: "When", cell: (r) => ago(r.created_at) }]} /></Card>
          </div>
        </div>)}</Async>
    </>
  );
}
