"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, DataTable, Button, Modal, FormField, Select, ConfirmDialog, EmptyState, StatusBadge } from "@/components/ui";
import { Async, useApi, useAct } from "@/components/features";
import { apiFetch, label } from "@/lib/client";

interface PM { id: string; user_id: string; role: string; email: string; display_name: string }
export default function ProjectMembers() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useApi<PM[]>(["pmembers", projectId], `/projects/${projectId}/members`);
  const project = useApi<{ organisation_id: string }>(["project", projectId], `/projects/${projectId}`);
  const org = useApi<{ members: { user_id: string; email: string; display_name: string; status: string }[] }>(["orgmembers", project.data?.organisation_id], project.data ? `/organisations/${project.data.organisation_id}/members` : null);
  const [open, setOpen] = React.useState(false); const [user, setUser] = React.useState(""); const [role, setRole] = React.useState("qa_tester"); const [rm, setRm] = React.useState<PM | null>(null);
  const add = useAct(() => apiFetch(`/projects/${projectId}/members`, { body: { userId: user, role } }), { ok: "Member added", invalidate: [["pmembers", projectId]], onSuccess: () => setOpen(false) });
  const remove = useAct((id: string) => apiFetch(`/projects/${projectId}/members/${id}`, { method: "DELETE" }), { ok: "Access removed", invalidate: [["pmembers", projectId]], onSuccess: () => setRm(null) });
  const candidates = (org.data?.members ?? []).filter((m) => m.status === "active" && !(q.data ?? []).some((p) => p.user_id === m.user_id));
  return (<>
    <div className="mb-4 flex justify-end"><Button variant="primary" onClick={() => setOpen(true)}>Add member</Button></div>
    <Card className="!p-0"><Async q={q}>{(rows) => <DataTable rows={rows} caption="Project members" empty={<EmptyState title="No members assigned" body="Org admins always have access. Invite testers from Members, then assign them here." />}
      cols={[{ key: "n", header: "Name", cell: (r) => r.display_name }, { key: "e", header: "Email", cell: (r) => r.email, hideOnMobile: true }, { key: "r", header: "Role", cell: (r) => <StatusBadge status="neutral">{label(r.role)}</StatusBadge> }, { key: "x", header: "", cell: (r) => <Button size="sm" variant="ghost" onClick={() => setRm(r)}>Remove access</Button> }]} />}</Async></Card>
    <Modal open={open} onClose={() => setOpen(false)} title="Add project member" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!user} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></>}>
      <FormField label="Organisation member" htmlFor="pm-u"><Select id="pm-u" value={user} onChange={(e) => setUser(e.target.value)}><option value="">Select…</option>{candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</option>)}</Select></FormField>
      <FormField label="Project role" htmlFor="pm-r"><Select id="pm-r" value={role} onChange={(e) => setRole(e.target.value)}>{["project_admin", "qa_manager", "qa_tester", "viewer"].map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select></FormField>
    </Modal>
    <ConfirmDialog open={!!rm} onClose={() => setRm(null)} danger title="Remove project access?" confirmLabel="Remove" loading={remove.isPending} onConfirm={() => rm && remove.mutate(rm.id)} body={<>{rm?.display_name} will immediately lose access to this project&apos;s builds and feedback.</>} />
  </>);
}
