"use client";
import * as React from "react";
import { PageHeader, Card, Button, FormField, Input, Textarea, Select } from "@/components/ui";
import { useApi, useAct } from "@/components/features";
import { apiFetch } from "@/lib/client";

export default function NewProject() {
  const orgs = useApi<{ id: string; name: string }[]>(["orgs"], "/organisations");
  const [f, setF] = React.useState({ organisationId: "", name: "", app_display_name: "", expected_bundle_identifier: "", description: "", default_qa_instructions: "", access_policy: "named_users_only" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const create = useAct(() => apiFetch<{ id: string }>("/projects", { body: { ...f, organisationId: f.organisationId || orgs.data?.[0]?.id, expected_bundle_identifier: f.expected_bundle_identifier || null } }), { ok: "Project created", onSuccess: (p) => { location.href = `/app/projects/${p.id}`; } });
  return (
    <>
      <PageHeader title="New project" breadcrumbs={[{ label: "Projects", href: "/app/projects" }, { label: "New" }]} />
      <Card className="max-w-2xl"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {(orgs.data?.length ?? 0) > 1 && <FormField label="Organisation" htmlFor="p-org"><Select id="p-org" value={f.organisationId} onChange={set("organisationId")} required><option value="">Select…</option>{orgs.data!.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FormField>}
        <FormField label="Project name" htmlFor="p-name"><Input id="p-name" required maxLength={100} value={f.name} onChange={set("name")} /></FormField>
        <FormField label="App display name" htmlFor="p-app"><Input id="p-app" value={f.app_display_name} onChange={set("app_display_name")} /></FormField>
        <FormField label="Expected bundle identifier (optional)" htmlFor="p-bid" hint="Uploads with a different identifier are flagged for review."><Input id="p-bid" placeholder="com.example.app" value={f.expected_bundle_identifier} onChange={set("expected_bundle_identifier")} /></FormField>
        <FormField label="Description" htmlFor="p-d"><Textarea id="p-d" value={f.description} onChange={set("description")} /></FormField>
        <FormField label="Default QA instructions" htmlFor="p-qa"><Textarea id="p-qa" value={f.default_qa_instructions} onChange={set("default_qa_instructions")} /></FormField>
        <FormField label="Customer access policy" htmlFor="p-pol" hint="Named-user access requires sign-in. Protected links can be opened by anyone holding the link (and password, if set)."><Select id="p-pol" value={f.access_policy} onChange={set("access_policy")}><option value="named_users_only">Signed-in members only (recommended)</option><option value="allow_protected_links">Allow protected links</option></Select></FormField>
        <div className="flex gap-2"><Button type="submit" variant="primary" loading={create.isPending}>Create project</Button><a href="/app/projects"><Button type="button">Cancel</Button></a></div>
      </form></Card>
    </>
  );
}
