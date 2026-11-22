"use client";
import { useParams, usePathname } from "next/navigation";
import { PageHeader, Tabs, StatusBadge, ErrorState } from "@/components/ui";
import { useApi } from "@/components/features";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>(); const path = usePathname();
  const q = useApi<{ name: string; status: string; app_display_name: string | null; expected_bundle_identifier: string | null }>(["project", projectId], `/projects/${projectId}`);
  const base = `/app/projects/${projectId}`;
  const tabs = [["overview", "Overview", ""], ["builds", "Builds", "/builds"], ["members", "Members", "/members"], ["distribution", "Distribution policies", "/distribution"], ["devices", "Devices (UDIDs)", "/devices"], ["previews", "Simulator previews", "/previews"], ["feedback", "Feedback", "/feedback"], ["activity", "Activity", "/activity"], ["settings", "Settings", "/settings"]].map(([key, label, p]) => ({ key, label, href: base + p }));
  const active = tabs.slice().reverse().find((t) => t.key !== "overview" && path.startsWith(t.href))?.key ?? "overview";
  if (q.error) return <ErrorState error={q.error} />;
  return (<>
    <PageHeader title={q.data?.name ?? "Loading…"} breadcrumbs={[{ label: "Projects", href: "/app/projects" }, { label: q.data?.name ?? "…" }]} description={q.data && <span className="flex items-center gap-2"><StatusBadge status={q.data.status} />{q.data.expected_bundle_identifier && <code className="text-xs">{q.data.expected_bundle_identifier}</code>}</span>} />
    <Tabs tabs={tabs} active={active} />{children}
  </>);
}
