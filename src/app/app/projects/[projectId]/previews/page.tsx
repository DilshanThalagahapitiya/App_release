"use client";
import { useParams } from "next/navigation";
import { Button, Callout, Card, EmptyState, StatusBadge } from "@/components/ui";
import { Async, useApi } from "@/components/features";
import { PREVIEW_LABEL, XcodeInstructions, DEVICES } from "@/components/simulator";
import { fmtDate } from "@/lib/client";

interface Item { id: string; build_id: string; status: string; status_detail: string | null; device: string; expires_at: string | null; uploaded_at: string | null; version: string | null; build_number: string | null; app_name: string | null; release_title: string | null; uploader: string | null }
export default function ProjectPreviews() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useApi<{ appetizeConfigured: boolean; items: Item[] }>(["previews", projectId], `/projects/${projectId}/previews`, { refetchInterval: 8000 });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-[var(--text-2)]">Let clients try a build in their browser, with no install and no device registration.</p><a href={`/app/projects/${projectId}/builds/upload?mode=simulator`}><Button variant="primary">Upload simulator build</Button></a></div>
      {q.data && !q.data.appetizeConfigured && <Callout tone="warn" title="Appetize is not configured on the server">Set the <code>APPETIZE_API_TOKEN</code> secret, then uploads are sent to Appetize automatically.</Callout>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><Card title="Simulator builds" className="!p-0"><Async q={q}>{(d) => d.items.length ? (
          <ul className="divide-y divide-[var(--border)]">{d.items.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
              <div className="min-w-0"><a className="font-medium" href={`/app/builds/${h.build_id}/preview`}>{h.app_name ?? "App"} {h.version ?? ""} ({h.build_number ?? "?"})</a><p className="text-xs muted">{h.uploaded_at ? fmtDate(h.uploaded_at) : ""} · {DEVICES.find(([v]) => v === h.device)?.[1] ?? h.device}{h.expires_at ? ` · expires ${fmtDate(h.expires_at)}` : ""}{h.uploader ? ` · ${h.uploader}` : ""}</p>{h.status === "failed" && h.status_detail && <p className="text-xs text-[var(--bad)]">{h.status_detail}</p>}</div>
              <StatusBadge status={h.status}>{PREVIEW_LABEL[h.status] ?? h.status}</StatusBadge>
            </li>))}</ul>) : <EmptyState title="No simulator builds yet" body="Upload a zipped iOS Simulator .app to create the first interactive preview." />}</Async></Card></div>
        <XcodeInstructions />
      </div>
    </div>
  );
}
