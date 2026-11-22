"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, Callout, StatusBadge, Modal, FormField, Input, Select, ConfirmDialog, EmptyState } from "@/components/ui";
import { useApi, useAct, DistributionLinkCard, CopyButton, QRCodePanel, type LinkDto } from "@/components/features";
import { DEVICES, PREVIEW_LABEL, PreviewSteps, XcodeInstructions } from "@/components/simulator";
import { PreviewEmbed } from "@/app/p/[token]/client";
import { apiFetch, fmtDate } from "@/lib/client";
import type { BuildDetail } from "../layout";

export interface PreviewDto { id: string; build_id: string; status: string; enabled: boolean; status_detail: string | null; error_code: string | null; attempts: number; file_type: string; mode: string; device: string; os_version: string | null; os_options?: number[]; expires_at: string | null; uploaded_at: string | null; ready_at: string | null; appetize_configured: boolean; embed_url?: string; open_url?: string; display?: "embed" | "link" }
interface HistoryItem extends PreviewDto { version: string | null; build_number: string | null; app_name: string | null; release_title: string | null; uploader: string | null }

interface Sharing { allMembers: boolean; members: { user_id: string; display_name: string; email: string; role: string; shared: boolean }[] }

/** Choose who sees the preview in their app (Available builds). */
function ShareCard({ buildId, ready }: { buildId: string; ready: boolean }) {
  const q = useApi<Sharing>(["pv-share", buildId], ready ? `/builds/${buildId}/preview/sharing` : null);
  const [sel, setSel] = React.useState<Set<string> | null>(null); const [all, setAll] = React.useState(false); const [find, setFind] = React.useState("");
  React.useEffect(() => { if (q.data && sel === null) { setSel(new Set(q.data.members.filter((m) => m.shared).map((m) => m.user_id))); setAll(q.data.allMembers); } }, [q.data, sel]);
  const save = useAct(() => apiFetch<Sharing>(`/builds/${buildId}/preview/sharing`, { method: "PUT", body: { allMembers: all, userIds: [...(sel ?? [])] } }), { ok: "Sharing saved", invalidate: [["pv-share", buildId], ["links", buildId]] });
  const members = (q.data?.members ?? []).filter((m) => `${m.display_name} ${m.email}`.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (id: string) => setSel((cur) => { const n = new Set(cur ?? []); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Card title="Share with members" actions={<Button size="sm" variant="primary" loading={save.isPending} disabled={!ready || !sel} why="The preview must be Ready first" onClick={() => save.mutate()}>Save</Button>}>
      <p className="text-[13px] text-[var(--text-2)]">People you add see this preview in their app under <b>Available builds</b>, marked as an interactive preview, and get a notification.</p>
      {!ready ? <p className="mt-3 text-[13px] muted">Available once the preview is Ready.</p> : !q.data || !sel ? <div className="skeleton mt-3 h-24" /> : (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-[14px] font-medium"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Everyone in this project ({q.data.members.length})</label>
          {!all && <>
            {q.data.members.length > 6 && <Input aria-label="Search members" placeholder="Search members…" value={find} onChange={(e) => setFind(e.target.value)} />}
            <ul className="max-h-64 divide-y divide-[var(--border)] overflow-auto rounded-lg border border-[var(--border)]">
              {members.map((m) => (<li key={m.user_id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[14px]"><input type="checkbox" checked={sel.has(m.user_id)} onChange={() => toggle(m.user_id)} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.display_name}</span><span className="block truncate text-xs muted">{m.email} · {m.role.replace(/_/g, " ")}</span></span></label></li>))}
              {!members.length && <li className="px-3 py-4 text-center text-[13px] muted">{q.data.members.length ? "No match." : "This project has no members yet. Add members on the project's Members tab."}</li>}
            </ul>
            <p className="text-xs muted">{sel.size} selected{sel.size ? "" : ". Nobody sees it in their app yet"}</p></>}
        </div>)}
    </Card>
  );
}

export default function BuildPreviewTab() {
  const { buildId } = useParams<{ buildId: string }>();
  const b = useApi<BuildDetail>(["build", buildId], `/builds/${buildId}`);
  const [poll, setPoll] = React.useState(3000);
  const pv = useApi<PreviewDto>(["preview", buildId], `/builds/${buildId}/preview`, { refetchInterval: poll });
  const links = useApi<LinkDto[]>(["links", buildId], `/builds/${buildId}/distribution-links`);
  const projectId = b.data?.project.id;
  const history = useApi<{ items: HistoryItem[] }>(["previews", projectId], projectId ? `/projects/${projectId}/previews` : null, { refetchInterval: 8000 });
  const [open, setOpen] = React.useState(false); const [created, setCreated] = React.useState<LinkDto | null>(null); const [rev, setRev] = React.useState<LinkDto | null>(null);
  const [confirm, setConfirm] = React.useState<"delete" | null>(null); const [show, setShow] = React.useState(false);
  const [f, setF] = React.useState({ accessScope: "protected_link", password: "", days: "14", allowFeedback: true, notes: "" });
  const inv = [["preview", buildId], ["previews", projectId], ["links", buildId]];
  const p = pv.data;
  React.useEffect(() => { if (p) setPoll(["pending", "uploading", "processing"].includes(p.status) ? 2500 : 15000); }, [p]);

  const retry = useAct(() => apiFetch(`/builds/${buildId}/preview/retry`, { method: "POST" }), { ok: "Retry started", invalidate: inv });
  const patch = useAct((body: Record<string, unknown>) => apiFetch(`/builds/${buildId}/preview`, { method: "PATCH", body }), { ok: "Saved", invalidate: inv });
  const del = useAct(() => apiFetch(`/builds/${buildId}/preview`, { method: "DELETE" }), { ok: "Preview deleted", invalidate: inv, onSuccess: () => setConfirm(null) });
  const create = useAct(() => apiFetch<LinkDto>(`/builds/${buildId}/distribution-links`, { body: { kind: "preview", accessScope: f.accessScope, userIds: [], password: f.password || undefined, expiresInDays: Number(f.days) || undefined, allowDownload: false, allowFeedback: f.allowFeedback, customerReleaseNotes: f.notes || undefined } }),
    { invalidate: [["links", buildId]], onSuccess: (l) => { setOpen(false); setCreated(l); } });
  const revoke = useAct((id: string) => apiFetch(`/distribution-links/${id}/revoke`, { method: "POST" }), { ok: "Link revoked", invalidate: [["links", buildId]], onSuccess: () => setRev(null) });

  if (pv.error) return <Callout tone="bad" title="Could not load the preview">{(pv.error as Error).message}</Callout>;
  if (!p) return <div className="skeleton h-64" />;
  const ready = p.status === "ready"; const live = ready || p.status === "disabled" || p.status === "expired";
  const previewLinks = (links.data ?? []).filter((l) => l.kind === "preview");
  const canCreate = ready;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {!p.appetize_configured && <Callout tone="warn" title="Appetize is not configured on the server">Set the <code>APPETIZE_API_TOKEN</code> secret (see docs/appetize.md), then press Retry.</Callout>}
        <Card title="Preview status" actions={<StatusBadge status={p.status}>{PREVIEW_LABEL[p.status] ?? p.status}</StatusBadge>}>
          <PreviewSteps status={p.status} detail={p.status === "ready" ? null : p.status_detail} />
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            <div><dt className="muted text-xs">Device</dt><dd>{DEVICES.find(([v]) => v === p.device)?.[1] ?? p.device}</dd></div>
            <div><dt className="muted text-xs">iOS version</dt><dd>{p.os_version ? `iOS ${p.os_version}` : "Latest"}{b.data?.minimum_os_version ? <span className="muted"> (app needs {b.data.minimum_os_version}+)</span> : null}</dd></div>
            <div><dt className="muted text-xs">Uploaded</dt><dd>{p.uploaded_at ? fmtDate(p.uploaded_at) : "—"}</dd></div>
            <div><dt className="muted text-xs">Expires</dt><dd>{p.expires_at ? fmtDate(p.expires_at) : "Never"}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {ready && (p.display === "link" && p.open_url ? <a href={p.open_url} target="_blank" rel="noopener noreferrer"><Button variant="primary">Open simulator</Button></a> : <Button variant="primary" onClick={() => setShow((x) => !x)}>{show ? "Close simulator" : "Open simulator"}</Button>)}
            {p.status === "failed" && <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>Retry upload</Button>}
            {live && p.status !== "expired" && <Button loading={patch.isPending} onClick={() => patch.mutate({ enabled: !p.enabled })}>{p.enabled ? "Disable preview" : "Enable preview"}</Button>}
            {p.status !== "deleted" && <Button variant="danger" onClick={() => setConfirm("delete")}>Delete preview</Button>}
          </div>
          {live && <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
            <FormField label="Device" htmlFor="pv-dev"><Select id="pv-dev" value={p.device} onChange={(e) => patch.mutate({ device: e.target.value })}>{DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
            <FormField label="Simulator iOS version" htmlFor="pv-os" hint="By default the simulator runs the oldest iOS version that still meets the app's minimum."><Select id="pv-os" value={p.os_version ?? "latest"} onChange={(e) => patch.mutate({ osVersion: e.target.value })}><option value="min">Match the app&apos;s minimum{b.data?.minimum_os_version ? ` (${b.data.minimum_os_version}+)` : ""}</option><option value="latest">Latest available</option>{(p.os_options ?? []).map((v) => <option key={v} value={String(v)}>iOS {v}</option>)}</Select></FormField>
            <FormField label="Preview expires" htmlFor="pv-exp" hint="Pick a new expiry or clear it."><div className="flex gap-2"><Select id="pv-exp" value="" onChange={(e) => e.target.value && patch.mutate({ expiresAt: e.target.value === "never" ? null : new Date(Date.now() + Number(e.target.value) * 86400000).toISOString() })}><option value="">Change…</option><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="never">Never</option></Select></div></FormField>
          </div>}
        </Card>

        {show && ready && p.display !== "link" && p.embed_url && <Card title="Simulator"><PreviewEmbed src={p.embed_url} appName={b.data?.app_name ?? "App"} /></Card>}

        <ShareCard buildId={buildId} ready={ready} />

        <Card title="Client preview links" actions={<Button size="sm" variant="primary" disabled={!canCreate} why="The preview must be Ready first" onClick={() => setOpen(true)}>Create client preview link</Button>}>
          {previewLinks.length ? <div className="space-y-3">{previewLinks.map((l) => <DistributionLinkCard key={l.id} l={l} onRevoke={() => setRev(l)} />)}</div>
            : <EmptyState title="No client links yet" body="Create a link to share the interactive preview. Clients open it in a browser; nothing is installed." />}
          <p className="mt-3 text-xs muted">Turn the preview off or delete it to stop it everywhere, including for anyone who kept the link.</p>
        </Card>

        <Card title="Version history" className="!p-0">
          <ul className="divide-y divide-[var(--border)]">
            {(history.data?.items ?? []).map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px] ${h.build_id === buildId ? "bg-[var(--accent-soft)]" : ""}`}>
                <div className="min-w-0"><a href={`/app/builds/${h.build_id}/preview`} className="font-medium">{h.app_name ?? "App"} {h.version ?? ""} ({h.build_number ?? "?"})</a><p className="text-xs muted">{h.uploaded_at ? fmtDate(h.uploaded_at) : ""}{h.uploader ? ` · ${h.uploader}` : ""}{h.build_id === buildId ? " · this build" : ""}</p></div>
                <StatusBadge status={h.status}>{PREVIEW_LABEL[h.status] ?? h.status}</StatusBadge>
              </li>))}
            {history.data && !history.data.items.length && <li className="px-4 py-6 text-center muted">No previews yet.</li>}
          </ul>
        </Card>
      </div>
      <div className="space-y-5"><XcodeInstructions /></div>

      <Modal open={open} onClose={() => setOpen(false)} title="Create client preview link" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Create link</Button></>}>
        <FormField label="Who can open it" htmlFor="pl-s" hint="“Anyone with the link” needs the project's customer access policy to allow protected links."><Select id="pl-s" value={f.accessScope} onChange={(e) => setF({ ...f, accessScope: e.target.value })}><option value="protected_link">Anyone with the link (optional password)</option><option value="project_members">Signed-in project members only</option></Select></FormField>
        {f.accessScope === "protected_link" && <FormField label="Password (optional)" htmlFor="pl-p"><Input id="pl-p" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></FormField>}
        <FormField label="Link expires in (days)" htmlFor="pl-d"><Input id="pl-d" type="number" min={1} max={365} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></FormField>
        <label className="flex gap-2 text-[13px]"><input type="checkbox" checked={f.allowFeedback} onChange={(e) => setF({ ...f, allowFeedback: e.target.checked })} />Let the client send feedback</label>
      </Modal>
      <Modal open={!!created} onClose={() => setCreated(null)} title="Client preview link" footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        {created && (<><p className="text-[13px] text-[var(--text-2)]">Share this link. It opens the interactive preview in the browser.</p><div className="flex items-center gap-2"><Input readOnly aria-label="Client preview link" value={created.url ?? ""} /><CopyButton text={created.url ?? ""} /></div><QRCodePanel linkId={created.id} url={created.url ?? ""} /></>)}
      </Modal>
      <Modal open={!!rev} onClose={() => setRev(null)} title="Revoke this link?" footer={<><Button onClick={() => setRev(null)}>Cancel</Button><Button variant="danger" loading={revoke.isPending} onClick={() => rev && revoke.mutate(rev.id)}>Revoke now</Button></>}><p>Anyone using this link loses access immediately.</p></Modal>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} danger title="Delete this preview?" confirmLabel="Delete preview" loading={del.isPending} onConfirm={() => del.mutate()} body="The app is removed from Appetize and every client link for this build stops working. The build stays in your history." />
    </div>
  );
}
