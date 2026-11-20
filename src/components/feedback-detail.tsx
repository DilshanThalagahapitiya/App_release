"use client";
import * as React from "react";
import { PageHeader, Card, KV, Button, Select, Textarea, StatusBadge, Callout, FormField } from "./ui";
import { Async, useApi, useAct, FeedbackStatusTimeline, CATEGORIES } from "./features";
import { apiFetch, fmtBytes, label, ago } from "@/lib/client";

interface FB { id: string; title: string; description: string; category: string; severity: string; status: string; project_id: string; project_name: string; build: { id: string; version: string | null; build_number: string | null } | null; reporter: { display_name: string; email?: string } | null; assigned_to_user_id: string | null; device_model: string | null; ios_version: string | null; reproduction_steps: string | null; expected_result: string | null; actual_result: string | null; created_at: string; comments: { id: string; body: string; visibility: string; created_at: string; author_name: string | null }[]; attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number }[]; history: { id: string; old_status: string | null; new_status: string; note: string | null; created_at: string; changed_by_name: string | null }[]; permissions: { canManage: boolean; canInternalComment: boolean } }

function Attachment({ a }: { a: FB["attachments"][number] }) {
  const open = useAct(() => apiFetch<{ url: string }>(`/feedback-attachments/${a.id}/url`), { onSuccess: (r) => window.open(r.url, "_blank", "noopener") });
  return <Button size="sm" loading={open.isPending} onClick={() => open.mutate()}>{a.original_filename} · {fmtBytes(a.size_bytes)}</Button>;
}
export function FeedbackDetail({ id, back }: { id: string; back: string }) {
  const q = useApi<FB>(["fb", id], `/feedback/${id}`);
  const staff = useApi<{ members: { user_id: string; display_name: string; role: string }[] }>(["fbstaff", q.data?.project_id], q.data?.permissions.canManage ? `/projects/${q.data.project_id}/members` as never : null);
  const [note, setNote] = React.useState(""); const [body, setBody] = React.useState(""); const [vis, setVis] = React.useState<"customer" | "internal">("customer");
  const inv = [["fb", id]];
  const status = useAct((s: string) => apiFetch(`/feedback/${id}/status`, { body: { status: s, note: note || null } }), { ok: "Status updated", invalidate: inv, onSuccess: () => setNote("") });
  const patch = useAct((p: object) => apiFetch(`/feedback/${id}`, { method: "PATCH", body: p }), { ok: "Updated", invalidate: inv });
  const comment = useAct(() => apiFetch(`/feedback/${id}/comments`, { body: { body, visibility: vis } }), { ok: "Comment posted", invalidate: inv, onSuccess: () => setBody("") });
  const people = (Array.isArray(staff.data) ? staff.data : []) as unknown as { user_id: string; display_name: string; role: string }[];
  return (<Async q={q}>{(f) => (<>
    <PageHeader title={f.title} breadcrumbs={[{ label: "Feedback", href: back }, { label: f.title }]} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={f.status} /><StatusBadge status={f.severity} />{label(f.category)} · {f.project_name}{f.build ? ` · ${f.build.version} (${f.build.build_number})` : ""}</span>} />
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Report"><div className="space-y-4"><p className="whitespace-pre-wrap">{f.description}</p>
          <KV items={[["Reporter", f.reporter ? `${f.reporter.display_name}${f.reporter.email ? ` (${f.reporter.email})` : ""}` : "—"], ["Device", f.device_model], ["iOS version", f.ios_version], ["Reported", ago(f.created_at)]]} />
          {f.reproduction_steps && <div><p className="text-xs muted">Steps to reproduce</p><p className="whitespace-pre-wrap">{f.reproduction_steps}</p></div>}
          {f.expected_result && <div><p className="text-xs muted">Expected</p><p className="whitespace-pre-wrap">{f.expected_result}</p></div>}
          {f.actual_result && <div><p className="text-xs muted">Actual</p><p className="whitespace-pre-wrap">{f.actual_result}</p></div>}
          {f.attachments.length > 0 && <div><p className="mb-1 text-xs muted">Attachments (links expire after 5 minutes)</p><div className="flex flex-wrap gap-2">{f.attachments.map((a) => <Attachment key={a.id} a={a} />)}</div></div>}</div></Card>
        <Card title="Conversation"><div className="space-y-3">
          {f.comments.length === 0 && <p className="text-[13px] muted">No comments yet.</p>}
          {f.comments.map((c) => (<div key={c.id} className={`rounded-lg p-3 text-[13px] ${c.visibility === "internal" ? "bg-[var(--warn-soft)]" : "bg-[var(--surface-2)]"}`}><div className="mb-1 flex items-center gap-2 text-xs muted"><b className="text-[var(--text)]">{c.author_name ?? "Unknown"}</b>{ago(c.created_at)}{c.visibility === "internal" && <StatusBadge status="warn">Internal</StatusBadge>}</div><p className="whitespace-pre-wrap">{c.body}</p></div>))}
          <FormField label="Add a comment" htmlFor="c-b"><Textarea id="c-b" value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
          <div className="flex flex-wrap items-center gap-2">{f.permissions.canInternalComment && <Select aria-label="Visibility" className="!w-56" value={vis} onChange={(e) => setVis(e.target.value as "customer" | "internal")}><option value="customer">Reply visible to the reporter</option><option value="internal">Internal note (hidden from customers)</option></Select>}<Button variant="primary" disabled={!body.trim()} loading={comment.isPending} onClick={() => comment.mutate()}>Post</Button></div></div></Card>
      </div>
      <div className="space-y-5">
        {f.permissions.canManage && <Card title="Manage"><div className="space-y-3">
          <FormField label="Move to status" htmlFor="m-s"><Select id="m-s" value="" onChange={(e) => e.target.value && status.mutate(e.target.value)}><option value="">Change status…</option>{["new", "triaged", "in_progress", "need_more_info", "resolved", "closed"].filter((s) => s !== f.status).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></FormField>
          <FormField label="Note for history (optional)" htmlFor="m-n"><Textarea id="m-n" className="!min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <FormField label="Severity" htmlFor="m-v"><Select id="m-v" value={f.severity} onChange={(e) => patch.mutate({ severity: e.target.value })}>{["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></FormField>
          <FormField label="Category" htmlFor="m-c"><Select id="m-c" value={f.category} onChange={(e) => patch.mutate({ category: e.target.value })}>{CATEGORIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></FormField>
          <FormField label="Owner" htmlFor="m-o"><Select id="m-o" value={f.assigned_to_user_id ?? ""} onChange={(e) => patch.mutate({ assignedToUserId: e.target.value || null })}><option value="">Unassigned</option>{people.filter((p) => p.role !== "qa_tester" && p.role !== "viewer").map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</Select></FormField>
          <p className="text-xs muted">Org admins can also be assigned via the API; this list shows project staff.</p></div></Card>}
        <Card title="Status history"><FeedbackStatusTimeline history={f.history} /></Card>
        {!f.permissions.canManage && <Callout tone="info">You&apos;ll be notified when the status changes.</Callout>}
      </div>
    </div></>)}</Async>);
}
