"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, Modal, FormField, Input, Textarea, Select, Callout, EmptyState } from "@/components/ui";
import { Async, useApi, useAct, DistributionLinkCard, CopyButton, QRCodePanel, type LinkDto } from "@/components/features";
import { apiFetch } from "@/lib/client";
import type { BuildDetail } from "../layout";

export default function BuildDistribution() {
  const { buildId } = useParams<{ buildId: string }>();
  const b = useApi<BuildDetail>(["build", buildId], `/builds/${buildId}`);
  const q = useApi<LinkDto[]>(["links", buildId], `/builds/${buildId}/distribution-links`);
  const members = useApi<{ user_id: string; display_name: string; email: string; role: string }[]>(["pm", b.data?.project.id], b.data ? `/projects/${b.data.project.id}/members` : null);
  const [open, setOpen] = React.useState(false); const [created, setCreated] = React.useState<LinkDto | null>(null); const [rev, setRev] = React.useState<LinkDto | null>(null);
  const [f, setF] = React.useState({ title: "", accessScope: "project_members", userIds: [] as string[], password: "", days: "14", maxDownloads: "", allowDownload: true, allowFeedback: true, notes: "", guidance: "" });
  const create = useAct(() => apiFetch<LinkDto>(`/builds/${buildId}/distribution-links`, { body: { title: f.title || undefined, accessScope: f.accessScope, userIds: f.userIds, password: f.password || undefined, expiresInDays: Number(f.days) || undefined, maxDownloads: f.maxDownloads ? Number(f.maxDownloads) : null, allowDownload: f.allowDownload, allowFeedback: f.allowFeedback, customerReleaseNotes: f.notes || null, installationGuidance: f.guidance || null } }), { ok: "Link created", invalidate: [["links", buildId]], onSuccess: (l) => { setCreated(l); setOpen(false); } });
  const revoke = useAct((id: string) => apiFetch(`/distribution-links/${id}/revoke`, { method: "POST" }), { ok: "Link revoked", invalidate: [["links", buildId]], onSuccess: () => setRev(null) });
  const published = b.data?.publish_status === "published";
  return (<div className="space-y-4">
    {b.data && !published && <Callout tone="warn" title="Build is not published">Publish the build before creating distribution links.</Callout>}
    <div className="flex justify-end"><Button variant="primary" disabled={!published} why="Publish the build first" onClick={() => setOpen(true)}>Create distribution link</Button></div>
    <Async q={q}>{(rows) => rows.length ? <div className="space-y-3">{rows.map((l) => (<div key={l.id}><DistributionLinkCard l={l} onRevoke={() => setRev(l)} /></div>))}</div> : <Card><EmptyState title="No links yet" body="Links open a protected, mobile-friendly page. They never bypass Apple's signing rules." /></Card>}</Async>
    <Modal open={open} onClose={() => setOpen(false)} title="Create distribution link" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={f.accessScope === "named_users" && !f.userIds.length} onClick={() => create.mutate()}>Create link</Button></>}>
      <FormField label="Title" htmlFor="l-t"><Input id="l-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
      <FormField label="Who can open it" htmlFor="l-s" hint="Protected links need the project's customer access policy to allow them."><Select id="l-s" value={f.accessScope} onChange={(e) => setF({ ...f, accessScope: e.target.value })}><option value="project_members">All project members (sign-in required)</option><option value="named_users">Named users (sign-in required)</option><option value="protected_link">Anyone with the link (protected link)</option></Select></FormField>
      {f.accessScope === "named_users" && <FormField label="Users" htmlFor="l-u"><select id="l-u" multiple className="h-32 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1" value={f.userIds} onChange={(e) => setF({ ...f, userIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{(members.data ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</option>)}</select></FormField>}
      {f.accessScope === "protected_link" && <FormField label="Password (optional)" htmlFor="l-p"><Input id="l-p" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></FormField>}
      <div className="grid grid-cols-2 gap-3"><FormField label="Expires in (days)" htmlFor="l-d"><Input id="l-d" type="number" min={1} max={365} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></FormField><FormField label="Max downloads (optional)" htmlFor="l-m"><Input id="l-m" type="number" min={1} value={f.maxDownloads} onChange={(e) => setF({ ...f, maxDownloads: e.target.value })} /></FormField></div>
      <label className="flex gap-2 text-[13px]"><input type="checkbox" checked={f.allowDownload} onChange={(e) => setF({ ...f, allowDownload: e.target.checked })} />Allow install / download</label>
      <label className="flex gap-2 text-[13px]"><input type="checkbox" checked={f.allowFeedback} onChange={(e) => setF({ ...f, allowFeedback: e.target.checked })} />Allow QA feedback</label>
      <FormField label="Customer-facing release notes" htmlFor="l-n"><Textarea id="l-n" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      <FormField label="Installation guidance" htmlFor="l-g"><Textarea id="l-g" value={f.guidance} onChange={(e) => setF({ ...f, guidance: e.target.value })} /></FormField>
    </Modal>
    <Modal open={!!created} onClose={() => setCreated(null)} title="Link created" footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
      {created && (<><div className="flex items-center gap-2"><Input readOnly aria-label="Distribution link" value={created.url ?? ""} /><CopyButton text={created.url ?? ""} /></div><QRCodePanel linkId={created.id} url={created.url ?? ""} /></>)}
    </Modal>
    <Modal open={!!rev} onClose={() => setRev(null)} title="Revoke this link?" footer={<><Button onClick={() => setRev(null)}>Cancel</Button><Button variant="danger" loading={revoke.isPending} onClick={() => rev && revoke.mutate(rev.id)}>Revoke now</Button></>}><p className="text-[var(--text-2)]">The link and its QR code stop working immediately. This cannot be undone.</p></Modal>
  </div>);
}
