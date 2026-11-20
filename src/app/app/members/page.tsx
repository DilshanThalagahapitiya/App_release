"use client";
import * as React from "react";
import { PageHeader, Card, DataTable, Button, Modal, FormField, Input, Select, ConfirmDialog, EmptyState, StatusBadge, Callout } from "@/components/ui";
import { Async, useApi, useAct, CopyButton } from "@/components/features";
import { apiFetch, label, fmtDay } from "@/lib/client";

interface M { id: string; user_id: string; role: string; status: string; email: string; display_name: string; last_login_at: string | null }
interface Inv { id: string; email: string; role: string; expires_at: string }
const ROLES = ["org_admin", "project_admin", "qa_manager", "qa_tester", "viewer"];

export default function Members() {
  const orgs = useApi<{ id: string; name: string }[]>(["orgs"], "/organisations");
  const [orgSel, setOrgSel] = React.useState("");
  const orgId = orgSel || (typeof location !== "undefined" ? new URLSearchParams(location.search).get("org") : null) || orgs.data?.[0]?.id || "";
  const q = useApi<{ members: M[]; invitations: Inv[] }>(["members", orgId], orgId ? `/organisations/${orgId}/members` : null);
  const projects = useApi<{ items: { id: string; name: string }[] }>(["projects", "all"], "/projects?pageSize=100");
  const inv = [["members", orgId]];
  const [open, setOpen] = React.useState(false); const [email, setEmail] = React.useState(""); const [role, setRole] = React.useState("qa_tester"); const [pids, setPids] = React.useState<string[]>([]);
  const [shown, setShown] = React.useState<{ inviteUrl: string; emailDelivery: string } | null>(null); const [rm, setRm] = React.useState<M | null>(null);
  const invite = useAct(() => apiFetch<{ inviteUrl: string; emailDelivery: string }>(`/organisations/${orgId}/invitations`, { body: { email, role, projectIds: pids } }), { ok: "Invitation created", invalidate: inv, onSuccess: (r) => { setShown(r); } });
  const resend = useAct((id: string) => apiFetch<{ inviteUrl: string; emailDelivery: string }>(`/invitations/${id}/resend`, { method: "POST" }), { ok: "Invitation re-issued", invalidate: inv, onSuccess: (r) => { setShown(r); setOpen(true); } });
  const revokeInv = useAct((id: string) => apiFetch(`/invitations/${id}/revoke`, { method: "POST" }), { ok: "Invitation revoked", invalidate: inv });
  const patch = useAct((v: { id: string; body: object }) => apiFetch(`/organisations/${orgId}/members/${v.id}`, { method: "PATCH", body: v.body }), { ok: "Member updated", invalidate: inv });
  const remove = useAct((id: string) => apiFetch(`/organisations/${orgId}/members/${id}`, { method: "DELETE" }), { ok: "Member removed", invalidate: inv, onSuccess: () => setRm(null) });
  return (<>
    <PageHeader title="Customers & members" description="Invite internal staff, QA testers and customers. Project access is assigned per project." actions={<>{(orgs.data?.length ?? 0) > 1 && <Select aria-label="Organisation" className="!w-48" value={orgId} onChange={(e) => setOrgSel(e.target.value)}>{orgs.data!.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}<Button variant="primary" disabled={!orgId} onClick={() => { setShown(null); setEmail(""); setPids([]); setOpen(true); }}>Invite member</Button></>} />
    {orgs.data?.length === 0 && <Card><EmptyState title="No organisation yet" body="Create an organisation first (Organisations → New organisation), then invite people here." action={<a href="/app/organisations"><Button variant="primary">Go to Organisations</Button></a>} /></Card>}
    <div className="space-y-5">
      {(orgs.data?.length ?? 1) > 0 && <Card title="Members" className="!p-0"><Async q={q}>{(d) => <DataTable rows={d.members} caption="Members" empty={<EmptyState title="No members" />} cols={[{ key: "n", header: "Name", cell: (m) => <><span className="font-medium">{m.display_name}</span><div className="text-xs muted">{m.email}</div></> }, { key: "r", header: "Role", cell: (m) => <Select aria-label={`Role for ${m.display_name}`} className="!w-40" value={m.role} onChange={(e) => patch.mutate({ id: m.id, body: { role: e.target.value } })}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select> }, { key: "s", header: "Status", cell: (m) => <StatusBadge status={m.status === "active" ? "active" : "paused"}>{label(m.status)}</StatusBadge> }, { key: "l", header: "Last sign-in", cell: (m) => fmtDay(m.last_login_at), hideOnMobile: true }, { key: "a", header: "", cell: (m) => <div className="flex gap-1.5"><Button size="sm" onClick={() => patch.mutate({ id: m.id, body: { status: m.status === "active" ? "deactivated" : "active" } })}>{m.status === "active" ? "Deactivate" : "Reactivate"}</Button><Button size="sm" variant="ghost" onClick={() => setRm(m)}>Remove</Button></div> }]} />}</Async></Card>}
      <Async q={q}>{(d) => d.invitations.length > 0 && <Card title="Pending invitations" className="!p-0"><DataTable rows={d.invitations} caption="Pending invitations" cols={[{ key: "e", header: "Email", cell: (i) => i.email }, { key: "r", header: "Role", cell: (i) => label(i.role) }, { key: "x", header: "Expires", cell: (i) => fmtDay(i.expires_at) }, { key: "a", header: "", cell: (i) => <div className="flex gap-1.5"><Button size="sm" onClick={() => resend.mutate(i.id)}>Resend</Button><Button size="sm" variant="ghost" onClick={() => revokeInv.mutate(i.id)}>Revoke</Button></div> }]} /></Card>}</Async>
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="Invite member" footer={shown ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>Send invitation</Button></>}>
      {shown ? (<div className="space-y-3"><Callout tone={shown.emailDelivery === "queued" ? "good" : "warn"} title={shown.emailDelivery === "queued" ? "Invitation email queued" : "Email delivery is not configured"}>{shown.emailDelivery === "queued" ? "They will receive a single-use link valid for 7 days." : "No email was sent. Share this single-use link yourself (valid 7 days). It is shown only once."}</Callout><div className="flex gap-2"><Input readOnly aria-label="Invitation link" value={shown.inviteUrl} /><CopyButton text={shown.inviteUrl} /></div></div>) : (<>
        <FormField label="Email" htmlFor="i-e"><Input id="i-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
        <FormField label="Role" htmlFor="i-r"><Select id="i-r" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select></FormField>
        {role !== "org_admin" && <FormField label="Projects" htmlFor="i-p" hint="Hold Ctrl/Cmd to pick several. Without a project they can sign in but see nothing."><select id="i-p" multiple className="h-28 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1" value={pids} onChange={(e) => setPids(Array.from(e.target.selectedOptions).map((o) => o.value))}>{(projects.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>}</>)}
    </Modal>
    <ConfirmDialog open={!!rm} onClose={() => setRm(null)} danger title="Remove member?" confirmLabel="Remove" loading={remove.isPending} onConfirm={() => rm && remove.mutate(rm.id)} body={<>{rm?.display_name} loses access to the organisation and every project immediately.</>} />
  </>);
}
