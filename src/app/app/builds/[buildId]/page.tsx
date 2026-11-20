"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Callout, FormField, Textarea, Input, Button, Select } from "@/components/ui";
import { BuildMetadata, EligibilityPanel, PipelineStages, useApi, useAct } from "@/components/features";
import { apiFetch } from "@/lib/client";
import type { BuildDetail } from "./layout";

export default function BuildOverview() {
  const { buildId } = useParams<{ buildId: string }>();
  const q = useApi<BuildDetail>(["build", buildId], `/builds/${buildId}`, { refetchInterval: 4000 });
  const b = q.data;
  const [notes, setNotes] = React.useState<{ rn: string; inn: string; url: string; method: string; dl: boolean } | null>(null);
  React.useEffect(() => { if (b && !notes) setNotes({ rn: b.release_notes ?? "", inn: b.internal_notes ?? "", url: b.external_install_url ?? "", method: b.distribution_method, dl: !!b.allow_download_when_ineligible }); }, [b, notes]);
  const save = useAct(() => apiFetch(`/builds/${buildId}`, { method: "PATCH", body: { release_notes: notes!.rn, internal_notes: notes!.inn, external_install_url: notes!.url || null, distribution_method: notes!.method, allow_download_when_ineligible: notes!.dl } }), { ok: "Saved", invalidate: [["build", buildId]] });
  if (!b || !notes) return <div className="skeleton h-64" />;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {b.validation_status !== "completed" && b.validation_status !== "failed" && <Callout tone="info" title="Validation in progress">This build is not validated yet and can't be published until a macOS worker has stored its report.</Callout>}
        <Card title="Build details"><BuildMetadata b={b} /></Card>
        {b.permissions.canEdit && <Card title="Release information"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <FormField label="Release notes (customer-visible)" htmlFor="rn"><Textarea id="rn" value={notes.rn} onChange={(e) => setNotes({ ...notes, rn: e.target.value })} /></FormField>
          <FormField label="Internal notes (staff only)" htmlFor="in"><Textarea id="in" value={notes.inn} onChange={(e) => setNotes({ ...notes, inn: e.target.value })} /></FormField>
          <FormField label="Distribution method" htmlFor="dm"><Select id="dm" value={notes.method} onChange={(e) => setNotes({ ...notes, method: e.target.value })}>{["determine_from_ipa", "ad_hoc", "enterprise", "development", "testflight", "app_store", "download_only"].map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</Select></FormField>
          {(notes.method === "testflight" || notes.method === "app_store") && <FormField label="Official Apple URL" htmlFor="eu"><Input id="eu" type="url" value={notes.url} onChange={(e) => setNotes({ ...notes, url: e.target.value })} /></FormField>}
          <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={notes.dl} onChange={(e) => setNotes({ ...notes, dl: e.target.checked })} />Allow download-only access when validation finds the build ineligible</label>
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button></form></Card>}
      </div>
      <div className="space-y-5">
        <EligibilityPanel b={b} report={b.validation} />
        <Card title="Processing"><PipelineStages b={b} job={b.latestJob} /></Card>
      </div>
    </div>
  );
}
