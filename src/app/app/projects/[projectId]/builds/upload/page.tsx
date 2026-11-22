"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, Button, FormField, Input, Textarea, Select, Callout, PageHeader, Breadcrumbs } from "@/components/ui";
import { FileDropzone, UploadProgress, useApi } from "@/components/features";
import { uploadIpa, type UploadState } from "@/lib/upload-client";
import { apiFetch } from "@/lib/client";
import { DEVICES, XcodeInstructions } from "@/components/simulator";

export default function UploadBuild() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useApi<{ name: string }>(["project", projectId], `/projects/${projectId}`);
  const [file, setFile] = React.useState<File | null>(null);
  const [f, setF] = React.useState({ releaseTitle: "", releaseNotes: "", internalNotes: "", declaredVersion: "", declaredBuildNumber: "", distributionMethod: "determine_from_ipa", externalInstallUrl: "", allowDownloadWhenIneligible: false, device: "iphone15pro", expiresInDays: "", updateExisting: false });
  const pv = useApi<{ appetizeConfigured: boolean }>(["previews", projectId], `/projects/${projectId}/previews`);
  React.useEffect(() => { if (new URLSearchParams(location.search).get("mode") === "simulator") setF((x) => ({ ...x, distributionMethod: "simulator_preview" })); }, []);
  const [state, setState] = React.useState<UploadState>({ phase: "idle", percent: 0, message: "" });
  const [error, setError] = React.useState(""); const abort = React.useRef<AbortController | null>(null); const idem = React.useRef(crypto.randomUUID());
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const sim = f.distributionMethod === "simulator_preview";
  const fileName = file?.name.toLowerCase() ?? "";
  const badFile = !!file && (sim ? !(fileName.endsWith(".zip") || fileName.endsWith(".tar.gz") || fileName.endsWith(".tgz")) : !fileName.endsWith(".ipa"));
  const external = f.distributionMethod === "testflight" || f.distributionMethod === "app_store";
  const busy = ["hashing", "uploading", "completing"].includes(state.phase);

  async function start() {
    if (!file) return;
    setError(""); abort.current = new AbortController();
    try {
      const { sessionId } = await uploadIpa(projectId, file, abort.current.signal, setState, idem.current, sim ? "simulator" : "ipa");
      const { device, expiresInDays, updateExisting, ...rest } = f;
      const b = await apiFetch<{ id: string }>(`/projects/${projectId}/builds`, { body: { uploadSessionId: sessionId, ...rest, externalInstallUrl: f.externalInstallUrl || null, ...(sim ? { preview: { device, expiresInDays: expiresInDays ? Number(expiresInDays) : null, updateExisting } } : {}) } });
      setState({ phase: "done", percent: 100, message: sim ? "Upload received. It is being sent to Appetize." : "Upload received. Validation has been queued." });
      location.href = sim ? `/app/builds/${b.id}/preview` : `/app/builds/${b.id}/validation`;
    } catch (e) {
      if ((e as Error).name === "AbortError") { setState({ phase: "cancelled", percent: 0, message: "Upload cancelled." }); return; }
      setState({ ...state, phase: "error" }); setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeader title={sim ? "Upload simulator build" : "Upload build"} breadcrumbs={[{ label: "Projects", href: "/app/projects" }, { label: project.data?.name ?? "…", href: `/app/projects/${projectId}` }, { label: "Upload" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><FileDropzone file={file} onFile={(x) => { setFile(x); idem.current = crypto.randomUUID(); setState({ phase: "idle", percent: 0, message: "" }); }} disabled={busy}
            accept={sim ? ".zip,.tar.gz,.tgz" : ".ipa"} packApp={sim} prompt={sim ? "Drag the Simulator .app folder here (or a .zip)" : undefined} note={sim ? "Drop the .app folder straight from Finder and it is zipped for you. Device .ipa files cannot run in the preview." : undefined} ariaLabel={sim ? "Choose simulator archive" : undefined} />
            {badFile && <div className="mt-3"><Callout tone="bad">{sim ? (fileName.endsWith(".ipa") ? "A device .ipa cannot run in the simulator preview. Upload a zipped iOS Simulator .app (.zip or .tar.gz) instead." : "Simulator builds must be a .zip or .tar.gz of the .app folder.") : "Only .ipa files are accepted."}</Callout></div>}</Card>
          <Card title="Release details"><div className="space-y-4">
            <FormField label="Release title" htmlFor="u-title"><Input id="u-title" value={f.releaseTitle} onChange={set("releaseTitle")} /></FormField>
            <div className="grid gap-4 sm:grid-cols-2"><FormField label="Version (optional)" htmlFor="u-v" hint="Values read from the IPA take precedence after validation."><Input id="u-v" value={f.declaredVersion} onChange={set("declaredVersion")} /></FormField><FormField label="Build number (optional)" htmlFor="u-bn"><Input id="u-bn" value={f.declaredBuildNumber} onChange={set("declaredBuildNumber")} /></FormField></div>
            <FormField label="Release notes (visible to customers)" htmlFor="u-rn"><Textarea id="u-rn" value={f.releaseNotes} onChange={set("releaseNotes")} /></FormField>
            <FormField label="Internal notes (never shown to customers)" htmlFor="u-in"><Textarea id="u-in" value={f.internalNotes} onChange={set("internalNotes")} /></FormField>
            <FormField label="Distribution method" htmlFor="u-dm" hint="“Determine from IPA” lets the validation result decide. Nothing is inferred from the file name.">
              <Select id="u-dm" value={f.distributionMethod} onChange={set("distributionMethod")}><option value="determine_from_ipa">Determine from IPA (recommended)</option><option value="ad_hoc">Ad Hoc (registered devices)</option><option value="enterprise">Apple Developer Enterprise Program (internal use)</option><option value="development">Development-signed</option><option value="simulator_preview">Interactive Simulator Preview (browser, via Appetize)</option><option value="testflight">TestFlight (official Apple link)</option><option value="app_store">App Store / Unlisted / Custom App (official Apple link)</option><option value="download_only">Download only</option></Select></FormField>
            {sim && <div className="space-y-4 rounded-xl border border-[var(--border)] p-4">
              {pv.data && !pv.data.appetizeConfigured && <Callout tone="warn" title="Appetize is not configured">Previews cannot be created until the server has the <code>APPETIZE_API_TOKEN</code> secret. You can still upload; it will be sent once the token is set (press Retry on the build&apos;s Preview tab).</Callout>}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Simulator device" htmlFor="u-dev"><Select id="u-dev" value={f.device} onChange={set("device")}>{DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
                <FormField label="Preview expires" htmlFor="u-exp" hint="After this the client page stops working."><Select id="u-exp" value={f.expiresInDays} onChange={set("expiresInDays")}><option value="">Never</option><option value="7">In 7 days</option><option value="14">In 14 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option></Select></FormField>
              </div>
              <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={f.updateExisting} onChange={(e) => setF({ ...f, updateExisting: e.target.checked })} /><span>Update the existing Appetize app for this application instead of creating a new one. <span className="muted">Older preview links then show the newest version. Leave off to keep every version separately viewable.</span></span></label>
            </div>}
            {external && <FormField label="Official Apple install / invitation URL" htmlFor="u-url" hint="TestFlight and App Store builds are installed through Apple. This platform only links to them."><Input id="u-url" type="url" placeholder="https://testflight.apple.com/join/…" value={f.externalInstallUrl} onChange={set("externalInstallUrl")} /></FormField>}
            {!sim && <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={f.allowDownloadWhenIneligible} onChange={(e) => setF({ ...f, allowDownloadWhenIneligible: e.target.checked })} /><span>Allow authorised download-only access even if validation finds the build ineligible for installation. <span className="muted">(Off by default.)</span></span></label>}
          </div></Card>
        </div>
        <div className="space-y-4">
          <Card title="Upload">
            {state.phase === "idle" || state.phase === "cancelled" ? <p className="text-[13px] text-[var(--text-2)]">{state.message || (sim ? "Select the zipped Simulator .app, then upload. It is checked, then sent to Appetize in the background." : "Select an IPA, then upload. The checksum is computed in your browser and verified again on the server.")}</p> : <UploadProgress phase={state.phase} percent={state.percent} message={state.message} onCancel={busy ? () => abort.current?.abort() : undefined} />}
            {error && <div className="mt-3 space-y-2"><Callout tone="bad">{error}</Callout><p className="text-xs muted">Already-uploaded parts are kept — pressing Retry resumes from where it stopped.</p></div>}
            <Button className="mt-4 w-full" variant="primary" disabled={!file || busy || badFile || (external && !f.externalInstallUrl)} onClick={start} why={sim ? "Choose a simulator .zip first" : "Choose an .ipa file first"}>{state.phase === "error" ? "Retry upload" : sim ? "Upload & create preview" : "Upload & validate"}</Button>
          </Card>
          {sim ? <XcodeInstructions /> : <Breadcrumbs items={[{ label: "After upload, a macOS worker inspects the file. A build is only “validated” once its report is stored." }]} />}
        </div>
      </div>
    </>
  );
}
