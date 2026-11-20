"use client";
import * as React from "react";
import { PageHeader, Card, DataTable, Button, Modal, FormField, Input, EmptyState, StatusBadge, Callout } from "@/components/ui";
import { Async, useApi, useAct, CopyButton } from "@/components/features";
import { apiFetch, fmtDay } from "@/lib/client";

interface Org { id: string; name: string; slug: string; status: string; created_at: string }
export default function Organisations() {
  const q = useApi<Org[]>(["orgs"], "/organisations");
  const [open, setOpen] = React.useState(false); const [name, setName] = React.useState(""); const [email, setEmail] = React.useState(""); const [result, setResult] = React.useState<{ inviteUrl: string; emailDelivery: string } | null>(null);
  const create = useAct(() => apiFetch<{ invitation: { inviteUrl: string; emailDelivery: string } | null }>("/organisations", { body: { name, adminEmail: email || undefined, timezone: "UTC" } }), { ok: "Organisation created", invalidate: [["orgs"]], onSuccess: (r) => { setResult(r.invitation); if (!r.invitation) setOpen(false); } });
  return (
    <>
      <PageHeader title="Organisations" description="Each organisation is an isolated tenant with its own members, projects and builds." actions={<Button variant="primary" onClick={() => { setResult(null); setName(""); setEmail(""); setOpen(true); }}>New organisation</Button>} />
      <Card className="!p-0"><Async q={q}>{(rows) => <DataTable rows={rows} caption="Organisations" empty={<EmptyState title="No organisations" body="Create the first organisation and invite its administrator." />} cols={[{ key: "n", header: "Name", cell: (r) => r.name }, { key: "s", header: "Slug", cell: (r) => <code>{r.slug}</code> }, { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> }, { key: "c", header: "Created", cell: (r) => fmtDay(r.created_at) }, { key: "m", header: "", cell: (r) => <a href={`/app/members?org=${r.id}`}>Members</a> }]} />}</Async></Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New organisation" footer={result ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>Create</Button></>}>
        {result ? (<div className="space-y-3"><Callout tone={result.emailDelivery === "queued" ? "good" : "warn"} title={result.emailDelivery === "queued" ? "Invitation email queued" : "Email delivery is not configured"}>{result.emailDelivery === "queued" ? "The administrator will receive an email." : "No invitation email was sent. Share this single-use link with the administrator yourself (valid 7 days)."}</Callout><div className="flex items-center gap-2"><Input readOnly value={result.inviteUrl} aria-label="Invitation link" /><CopyButton text={result.inviteUrl} /></div></div>) : (<>
          <FormField label="Name" htmlFor="o-n"><Input id="o-n" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label="First administrator's email (optional)" htmlFor="o-e" hint="They receive a one-time invitation."><Input id="o-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField></>)}
      </Modal>
    </>
  );
}
