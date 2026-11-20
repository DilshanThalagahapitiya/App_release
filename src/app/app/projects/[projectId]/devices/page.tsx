"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, DataTable, Modal, FormField, Input, Callout, EmptyState, StatusBadge } from "@/components/ui";
import { Async, useApi, useAct, CopyButton } from "@/components/features";
import { apiFetch, fmtDate } from "@/lib/client";

interface Data { requests: { id: string; label: string; status: string; expired: boolean; expires_at: string; collected: number; url: string | null }[]; devices: { id: string; udid: string; product: string | null; os_version: string | null; device_name: string | null; label: string | null; created_at: string }[] }
export default function Devices() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useApi<Data>(["devices", projectId], `/projects/${projectId}/devices`, { refetchInterval: 10000 });
  const [open, setOpen] = React.useState(false); const [label, setLabel] = React.useState(""); const [made, setMade] = React.useState<{ url: string } | null>(null);
  const create = useAct(() => apiFetch<{ url: string }>(`/projects/${projectId}/devices`, { body: { label, expiresInDays: 14 } }), { invalidate: [["devices", projectId]], onSuccess: (r) => setMade(r) });
  const revoke = useAct((id: string) => apiFetch(`/device-requests/${id}/revoke`, { method: "POST" }), { ok: "Request link revoked", invalidate: [["devices", projectId]] });
  const del = useAct((id: string) => apiFetch(`/devices/${id}`, { method: "DELETE" }), { ok: "Device removed", invalidate: [["devices", projectId]] });
  return (<div className="space-y-5">
    <Callout tone="info" title="How this works">Create a link for a client and send it. They open it in Safari and tap through Apple&apos;s own screens; their device ID appears below within seconds. Then register it at developer.apple.com → Devices, rebuild your Ad Hoc IPA, and upload it. A device ID alone does not make an existing build installable.</Callout>
    <div className="flex flex-wrap justify-end gap-2"><a href={`/api/v1/projects/${projectId}/devices?format=txt`}><Button>Download list for Apple (.txt)</Button></a><Button variant="primary" onClick={() => { setMade(null); setLabel(""); setOpen(true); }}>New request link</Button></div>
    <Card title="Collected devices" className="!p-0"><Async q={q}>{(d) => <DataTable rows={d.devices} caption="Devices" empty={<EmptyState title="No devices yet" body="Create a request link and send it to your client." />}
      cols={[{ key: "l", header: "From", cell: (r) => r.label ?? "—" }, { key: "u", header: "Device ID (UDID)", cell: (r) => <code className="break-all text-xs">{r.udid}</code> }, { key: "p", header: "Model / iOS", cell: (r) => `${r.product ?? "—"} · ${r.os_version ?? "—"}`, hideOnMobile: true }, { key: "t", header: "Received", cell: (r) => fmtDate(r.created_at), hideOnMobile: true }, { key: "a", header: "", cell: (r) => <div className="flex gap-1.5"><CopyButton text={r.udid} label="Copy" /><Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>Remove</Button></div> }]} />}</Async></Card>
    <Card title="Request links" className="!p-0"><Async q={q}>{(d) => <DataTable rows={d.requests} caption="Requests" empty={<EmptyState title="No request links" />}
      cols={[{ key: "l", header: "Client", cell: (r) => r.label }, { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status === "revoked" ? "revoked" : r.expired ? "expired" : "active"} /> }, { key: "c", header: "Devices", cell: (r) => r.collected }, { key: "e", header: "Expires", cell: (r) => fmtDate(r.expires_at), hideOnMobile: true }, { key: "a", header: "", cell: (r) => r.url && !r.expired ? <div className="flex gap-1.5"><CopyButton text={r.url} /><Button size="sm" variant="ghost" onClick={() => revoke.mutate(r.id)}>Revoke</Button></div> : null }]} />}</Async></Card>
    <Modal open={open} onClose={() => setOpen(false)} title="New device request link" footer={made ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!label.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create link</Button></>}>
      {made ? (<div className="space-y-3"><p className="text-[13px] text-[var(--text-2)]">Send this to your client (WhatsApp, SMS or email). It works for 14 days, and must be opened in Safari on the iPhone.</p><div className="flex gap-2"><Input readOnly aria-label="Request link" value={made.url} /><CopyButton text={made.url} /></div></div>) : <FormField label="Client name" htmlFor="d-l" hint="So you know whose device it is."><Input id="d-l" value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>}
    </Modal>
  </div>);
}
