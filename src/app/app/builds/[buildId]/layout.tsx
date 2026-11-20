"use client";
import * as React from "react";
import { useParams, usePathname } from "next/navigation";
import { PageHeader, Tabs, StatusBadge, ErrorState, Button, ConfirmDialog } from "@/components/ui";
import { useApi, useAct, type BuildDto } from "@/components/features";
import { apiFetch } from "@/lib/client";

export interface BuildDetail extends BuildDto { project: { id: string; name: string }; permissions: { canPublish: boolean; canDownloadIpa: boolean; canManageLinks: boolean; canDelete: boolean; canEdit: boolean; canRevalidate: boolean }; latestJob: { status: string; progress_message: string | null; error_message: string | null; attempt_count: number; max_attempts: number } | null; validation: import("@/components/features").ReportDto | null }

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  const { buildId } = useParams<{ buildId: string }>(); const path = usePathname();
  const q = useApi<BuildDetail>(["build", buildId], `/builds/${buildId}`, { refetchInterval: 4000 });
  const [confirm, setConfirm] = React.useState<"delete" | "archive" | null>(null);
  const inv = [["build", buildId]];
  const publish = useAct(() => apiFetch(`/builds/${buildId}/publish`, { method: "POST" }), { ok: "Build published", invalidate: inv });
  const unpublish = useAct(() => apiFetch(`/builds/${buildId}/unpublish`, { method: "POST" }), { ok: "Build unpublished", invalidate: inv });
  const reval = useAct(() => apiFetch(`/builds/${buildId}/revalidate`, { method: "POST" }), { ok: "Re-validation queued", invalidate: inv });
  const ipa = useAct(() => apiFetch<{ url: string }>(`/builds/${buildId}/download`, { method: "POST" }), { onSuccess: (r) => { location.href = r.url; } });
  const archive = useAct(() => apiFetch(`/builds/${buildId}/archive`, { method: "POST" }), { ok: "Build archived — links revoked", invalidate: inv, onSuccess: () => setConfirm(null) });
  const del = useAct(() => apiFetch(`/builds/${buildId}`, { method: "DELETE" }), { ok: "Build deleted", onSuccess: () => { location.href = "/app/projects"; } });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const b = q.data; const base = `/app/builds/${buildId}`;
  const tabs = [{ key: "overview", label: "Overview", href: base }, { key: "validation", label: "Validation", href: base + "/validation" }, { key: "distribution", label: "Distribution", href: base + "/distribution" }];
  const active = path.endsWith("/validation") ? "validation" : path.endsWith("/distribution") ? "distribution" : "overview";
  const p = b?.permissions;
  const whyNot = !b ? "" : b.validation_status !== "completed" && !(["testflight", "app_store"].includes(b.distribution_method)) ? "Validation must complete first" : b.eligibility_status === "not_eligible" && !b.allow_download_when_ineligible ? "Not eligible; enable download-only access in Overview to publish anyway" : "";
  return (<>
    <PageHeader title={b ? `${b.app_name ?? b.original_filename} ${b.version ?? ""}`.trim() : "Loading…"} breadcrumbs={[{ label: "Projects", href: "/app/projects" }, { label: b?.project.name ?? "…", href: b ? `/app/projects/${b.project.id}/builds` : undefined }, { label: b ? `Build ${b.build_number ?? ""}` : "…" }]}
      description={b && <span className="flex flex-wrap items-center gap-2"><StatusBadge status={b.validation_status} /><StatusBadge status={b.eligibility_status} /><StatusBadge status={b.publish_status} />{b.release_title}</span>}
      actions={b && p && (<>
        {p.canPublish && (b.publish_status === "published" ? <Button loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Unpublish</Button> : b.publish_status !== "archived" && <Button variant="primary" loading={publish.isPending} disabled={!!whyNot} why={whyNot} onClick={() => publish.mutate()}>Publish</Button>)}
        {p.canRevalidate && <Button loading={reval.isPending} onClick={() => reval.mutate()} disabled={["pending", "running"].includes(b.validation_status)} why="A validation is already in progress">Re-validate</Button>}
        {p.canDownloadIpa && <Button loading={ipa.isPending} onClick={() => ipa.mutate()}>Download IPA</Button>}
        {p.canPublish && b.publish_status !== "archived" && <Button onClick={() => setConfirm("archive")}>Archive</Button>}
        {p.canDelete && <Button variant="danger" onClick={() => setConfirm("delete")}>Delete</Button>}</>)} />
    <Tabs tabs={tabs} active={active} />{children}
    <ConfirmDialog open={confirm === "archive"} onClose={() => setConfirm(null)} title="Archive this build?" confirmLabel="Archive" loading={archive.isPending} onConfirm={() => archive.mutate()} body="Archiving revokes every distribution link for this build. It remains available to administrators." />
    <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} danger title="Delete this build?" confirmLabel="Delete build" loading={del.isPending} onConfirm={() => del.mutate()} body="The build disappears immediately and all of its links are revoked. Stored files are permanently purged after the 30-day retention window." />
  </>);
}
