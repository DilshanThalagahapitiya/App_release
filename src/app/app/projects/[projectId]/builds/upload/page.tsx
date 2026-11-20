"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, FormField, Input, Textarea, Select, Callout, PageHeader, Breadcrumbs } from "@/components/ui";
import { FileDropzone, UploadProgress, useApi } from "@/components/features";
import { uploadIpa, type UploadState } from "@/lib/upload-client";
import { apiFetch } from "@/lib/client";

export default function UploadBuild() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useApi<{ name: string }>(["project", projectId], `/projects/${projectId}`);
  const [file, setFile] = React.useState<File | null>(null);
  const [f, setF] = React.useState({ releaseTitle: "", releaseNotes: "", internalNotes: "", declaredVersion: "", declaredBuildNumber: "", distributionMethod: "determine_from_ipa", externalInstallUrl: "", allowDownloadWhenIneligible: false });
  const [state, setState] = React.useState<UploadState>({ phase: "idle", percent: 0, message: "" });
  const [error, setError] = React.useState(""); const abort = React.useRef<AbortController | null>(null); const idem = React.useRef(crypto.randomUUID());
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const external = f.distributionMethod === "testflight" || f.distributionMethod === "app_store";
  const busy = ["hashing", "uploading", "completing"].includes(state.phase);

  async function start() {
    if (!file) return;
    setError(""); abort.current = new AbortController();
    try {
      const { sessionId } = await uploadIpa(projectId, file, abort.current.signal, setState, idem.current);
      const b = await apiFetch<{ id: string }>(`/projects/${projectId}/builds`, { body: { uploadSessionId: sessionId, ...f, externalInstallUrl: f.externalInstallUrl || null } });
      setState({ phase: "done", percent: 100, message: "Upload received. Validation has been queued." });
      location.href = `/app/builds/${b.id}/validation`;
    } catch (e) {
      if ((e as Error).name === "AbortError") { setState({ phase: "cancelled", percent: 0, message: "Upload cancelled." }); return; }
      setState({ ...state, phase: "error" }); setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeader title="Upload build" breadcrumbs={[{ label: "Projects", href: "/app/projects" }, { label: project.data?.name ?? "…", href: `/app/projects/${projectId}` }, { label: "Upload" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><FileDropzone file={file} onFile={(x) => { setFile(x); idem.current = crypto.randomUUID(); setState({ phase: "idle", percent: 0, message: "" }); }} disabled={busy} />
            {file && !file.name.toLowerCase().endsWith(".ipa") && <div className="mt-3"><Callout tone="bad">Only .ipa files are accepted.</Callout></div>}</Card>
          <Card title="Release details"><div className="space-y-4">
            <FormField label="Release title" htmlFor="u-title"><Input id="u-title" value={f.releaseTitle} onChange={set("releaseTitle")} /></FormField>
            <div className="grid gap-4 sm:grid-cols-2"><FormField label="Version (optional)" htmlFor="u-v" hint="Values read from the IPA take precedence after validation."><Input id="u-v" value={f.declaredVersion} onChange={set("declaredVersion")} /></FormField><FormField label="Build number (optional)" htmlFor="u-bn"><Input id="u-bn" value={f.declaredBuildNumber} onChange={set("declaredBuildNumber")} /></FormField></div>
            <FormField label="Release notes (visible to customers)" htmlFor="u-rn"><Textarea id="u-rn" value={f.releaseNotes} onChange={set("releaseNotes")} /></FormField>
            <FormField label="Internal notes (never shown to customers)" htmlFor="u-in"><Textarea id="u-in" value={f.internalNotes} onChange={set("internalNotes")} /></FormField>
            <FormField label="Distribution method" htmlFor="u-dm" hint="“Determine from IPA” lets the validation result decide. Nothing is inferred from the file name.">
              <Select id="u-dm" value={f.distributionMethod} onChange={set("distributionMethod")}><option value="determine_from_ipa">Determine from IPA (recommended)</option><option value="ad_hoc">Ad Hoc (registered devices)</option><option value="enterprise">Apple Developer Enterprise Program (internal use)</option><option value="development">Development-signed</option><option value="testflight">TestFlight (official Apple link)</option><option value="app_store">App Store / Unlisted / Custom App (official Apple link)</option><option value="download_only">Download only</option></Select></FormField>
            {external && <FormField label="Official Apple install / invitation URL" htmlFor="u-url" hint="TestFlight and App Store builds are installed through Apple. This platform only links to them."><Input id="u-url" type="url" placeholder="https://testflight.apple.com/join/…" value={f.externalInstallUrl} onChange={set("externalInstallUrl")} /></FormField>}
            <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={f.allowDownloadWhenIneligible} onChange={(e) => setF({ ...f, allowDownloadWhenIneligible: e.target.checked })} /><span>Allow authorised download-only access even if validation finds the build ineligible for installation. <span className="muted">(Off by default.)</span></span></label>
          </div></Card>
        </div>
        <div className="space-y-4">
          <Card title="Upload">
            {state.phase === "idle" || state.phase === "cancelled" ? <p className="text-[13px] text-[var(--text-2)]">{state.message || "Select an IPA, then upload. The checksum is computed in your browser and verified again on the server."}</p> : <UploadProgress phase={state.phase} percent={state.percent} message={state.message} onCancel={busy ? () => abort.current?.abort() : undefined} />}
            {error && <div className="mt-3 space-y-2"><Callout tone="bad">{error}</Callout><p className="text-xs muted">Already-uploaded parts are kept — pressing Retry resumes from where it stopped.</p></div>}
            <Button className="mt-4 w-full" variant="primary" disabled={!file || busy || (external && !f.externalInstallUrl)} onClick={start} why="Choose an .ipa file first">{state.phase === "error" ? "Retry upload" : "Upload & validate"}</Button>
          </Card>
          <Breadcrumbs items={[{ label: "After upload, a macOS worker inspects the file. A build is only “validated” once its report is stored." }]} />
        </div>
      </div>
    </>
  );
}
