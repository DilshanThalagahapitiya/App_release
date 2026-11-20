"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, FormField, Input, Textarea, Select, ConfirmDialog } from "@/components/ui";
import { Async, useApi, useAct } from "@/components/features";
import { apiFetch } from "@/lib/client";

interface P { name: string; description: string | null; app_display_name: string | null; expected_bundle_identifier: string | null; default_qa_instructions: string | null; default_install_instructions: string | null; access_policy: string; feedback_enabled: number; status: string }
function Form({ p, id }: { p: P; id: string }) {
  const [f, setF] = React.useState({ ...p, expected_bundle_identifier: p.expected_bundle_identifier ?? "", description: p.description ?? "", app_display_name: p.app_display_name ?? "", default_qa_instructions: p.default_qa_instructions ?? "", default_install_instructions: p.default_install_instructions ?? "" });
  const [del, setDel] = React.useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAct(() => apiFetch(`/projects/${id}`, { method: "PATCH", body: { name: f.name, description: f.description, app_display_name: f.app_display_name, expected_bundle_identifier: f.expected_bundle_identifier || null, default_qa_instructions: f.default_qa_instructions, default_install_instructions: f.default_install_instructions, access_policy: f.access_policy, feedback_enabled: !!Number(f.feedback_enabled), status: f.status } }), { ok: "Settings saved", invalidate: [["project", id]] });
  const archive = useAct(() => apiFetch(`/projects/${id}`, { method: "DELETE" }), { ok: "Project archived", onSuccess: () => { location.href = "/app/projects"; } });
  return (<div className="max-w-2xl space-y-5">
    <Card title="App identity & policy"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <FormField label="Project name" htmlFor="s-n"><Input id="s-n" value={f.name} onChange={set("name")} /></FormField>
      <FormField label="App display name" htmlFor="s-a"><Input id="s-a" value={f.app_display_name} onChange={set("app_display_name")} /></FormField>
      <FormField label="Expected bundle identifier" htmlFor="s-b"><Input id="s-b" value={f.expected_bundle_identifier} onChange={set("expected_bundle_identifier")} /></FormField>
      <FormField label="Description" htmlFor="s-d"><Textarea id="s-d" value={f.description} onChange={set("description")} /></FormField>
      <FormField label="Default QA instructions" htmlFor="s-q"><Textarea id="s-q" value={f.default_qa_instructions} onChange={set("default_qa_instructions")} /></FormField>
      <FormField label="Default installation instructions" htmlFor="s-i"><Textarea id="s-i" value={f.default_install_instructions} onChange={set("default_install_instructions")} /></FormField>
      <FormField label="Customer access policy" htmlFor="s-p"><Select id="s-p" value={f.access_policy} onChange={set("access_policy")}><option value="named_users_only">Signed-in members only</option><option value="allow_protected_links">Allow protected links</option></Select></FormField>
      <FormField label="Feedback" htmlFor="s-f"><Select id="s-f" value={String(f.feedback_enabled)} onChange={set("feedback_enabled")}><option value="1">Enabled</option><option value="0">Disabled</option></Select></FormField>
      <FormField label="Project status" htmlFor="s-s" hint="Paused projects accept no new uploads."><Select id="s-s" value={f.status} onChange={set("status")}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></Select></FormField>
      <Button type="submit" variant="primary" loading={save.isPending}>Save changes</Button>
    </form></Card>
    <Card title="Danger zone"><p className="mb-3 text-[13px] text-[var(--text-2)]">Archiving unpublishes all builds and revokes every distribution link immediately. Data is purged later under the retention policy.</p><Button variant="danger" onClick={() => setDel(true)}>Archive project</Button></Card>
    <ConfirmDialog open={del} onClose={() => setDel(false)} danger confirmLabel="Archive project" title="Archive this project?" loading={archive.isPending} onConfirm={() => archive.mutate()} body="All distribution links will stop working right away." />
  </div>);
}
export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useApi<P>(["project", projectId], `/projects/${projectId}`);
  return <Async q={q}>{(p) => <Form p={p} id={projectId} />}</Async>;
}
