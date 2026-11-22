"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDashed, Copy, Download, FileUp, Loader2, QrCode, ShieldCheck, X } from "lucide-react";
import { apiFetch, fmtBytes, fmtDate, label, ago } from "@/lib/client";
import { appFromFileList, collectApp, packApp as packAppZip } from "@/lib/zip-folder";
import { Button, Callout, Card, cx, ErrorState, FormField, Input, KV, LoadingSkeleton, Select, StatusBadge, Textarea, useToast } from "./ui";

export function useApi<T>(key: unknown[], path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: key, queryFn: () => apiFetch<T>(path!), enabled: !!path, refetchInterval: opts.refetchInterval });
}
export function useAct<V = void, R = unknown>(fn: (v: V) => Promise<R>, opts: { ok?: string; invalidate?: unknown[][]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient(); const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => { if (opts.ok) toast("ok", opts.ok); opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k })); opts.onSuccess?.(r); },
    onError: (e) => toast("err", (e as Error).message),
  });
}
export function Async<T>({ q, children, skeleton }: { q: { isLoading: boolean; error: unknown; data?: T; refetch: () => void }; children: (d: T) => React.ReactNode; skeleton?: React.ReactNode }) {
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  // A query that is disabled (waiting on another request) has no data yet: show the loading state, never call children(undefined).
  if (q.isLoading || q.data === undefined) return <>{skeleton ?? <LoadingSkeleton />}</>;
  return <>{children(q.data as T)}</>;
}

// ---------------------------------------------------------------- build presentation
export interface BuildDto {
  id: string; project_id: string; app_name: string | null; bundle_identifier: string | null; version: string | null; build_number: string | null; minimum_os_version: string | null;
  supported_device_families: number[]; architectures: string[]; file_size_bytes: number; sha256: string; uploaded_at: string; uploader_name?: string | null;
  build_kind?: "ipa" | "simulator"; validation_status: string; eligibility_status: string; processing_status: string; publish_status: string; release_title: string | null; release_notes: string | null; internal_notes?: string | null;
  distribution_method: string; external_install_url: string | null; allow_download_when_ineligible: number; original_filename: string; validated_at: string | null; published_at: string | null;
}
const FAMILIES: Record<number, string> = { 1: "iPhone", 2: "iPad" };

export function BuildMetadata({ b }: { b: BuildDto }) {
  return (
    <KV items={[
      ["App name", b.app_name], ["Bundle identifier", <code key="b">{b.bundle_identifier ?? "—"}</code>], ["Version", b.version], ["Build number", b.build_number],
      ["Minimum iOS", b.minimum_os_version], ["Device families", b.supported_device_families.map((f) => FAMILIES[f] ?? `Family ${f}`).join(", ") || "—"],
      ["Architectures", b.architectures.join(", ") || "—"], ["File size", fmtBytes(b.file_size_bytes)], ["Uploaded", `${fmtDate(b.uploaded_at)}${b.uploader_name ? ` by ${b.uploader_name}` : ""}`],
      ["SHA-256", <code key="s" className="break-all text-xs">{b.sha256}</code>], ["Distribution method", label(b.distribution_method)], ["Original file", b.original_filename],
    ]} />
  );
}

const STAGES = [["upload_received", "Upload received"], ["integrity_check", "File integrity check"], ["structure_inspection", "IPA structure inspection"], ["metadata_extraction", "Metadata extraction"], ["signature_inspection", "Signature/profile inspection"], ["eligibility_assessment", "Distribution eligibility assessment"], ["complete", "Complete / Needs review / Failed"]] as const;
export function PipelineStages({ b, job }: { b: Pick<BuildDto, "processing_status" | "validation_status" | "eligibility_status">; job?: { status: string; progress_message?: string | null; error_message?: string | null; attempt_count?: number; max_attempts?: number } | null }) {
  const cur = b.validation_status === "completed" || b.validation_status === "failed" ? 6 : Math.max(0, STAGES.findIndex(([k]) => k === b.processing_status));
  const failed = b.validation_status === "failed";
  return (
    <ol className="space-y-2" aria-label="Processing stages">
      {STAGES.map(([k, l], i) => {
        const done = i < cur || (i === 6 && b.validation_status === "completed"); const active = i === cur && !failed && b.validation_status !== "completed";
        const bad = failed && i === 6; const name = i === 6 ? (failed ? "Failed" : b.eligibility_status === "needs_review" && b.validation_status === "completed" ? "Needs review" : "Complete") : l;
        return (
          <li key={k} className="flex items-center gap-2.5 text-[13px]">
            {bad ? <X className="h-4 w-4 text-[var(--bad)]" aria-hidden /> : done ? <Check className="h-4 w-4 text-[var(--good)]" aria-hidden /> : active ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" aria-hidden /> : <CircleDashed className="h-4 w-4 text-[var(--text-3)]" aria-hidden />}
            <span className={cx(!done && !active && !bad && "muted", active && "font-medium")}>{name}</span><span className="sr-only">{done ? "done" : active ? "in progress" : bad ? "failed" : "pending"}</span>
          </li>);
      })}
      {job?.progress_message && b.validation_status === "running" && <li className="pl-7 text-xs muted">{job.progress_message}</li>}
      {job?.error_message && <li className="pl-7 text-xs text-[var(--bad)]">{job.error_message}{job.max_attempts ? ` (attempt ${job.attempt_count}/${job.max_attempts})` : ""}</li>}
    </ol>
  );
}

export interface ReportDto { overall_status: string; eligibility_status: string; metadata: { file?: { sizeBytes: number; sha256: string } }; signing: { verification?: string; identitySummary?: string; teamIdentifier?: string }; profile: { present?: boolean; profileType?: string; expiresAt?: string; expired?: boolean; deviceCount?: number | null; devices?: string[] | null; deviceRegistrationRequired?: boolean; name?: string; teamIdentifier?: string; appIdMatchesBundle?: boolean | null }; entitlements: { getTaskAllow?: boolean | null; apsEnvironment?: string | null; associatedDomainsCount?: number; keys?: string[] }; checks: { code: string; status: string; message: string }[]; warnings: string[]; errors: { code: string; message: string }[]; limitations: string[]; completed_at: string; worker_version: string | null }

const ELIG_COPY: Record<string, string> = {
  eligible: "Passed every check this platform can perform. Installation still depends on the target device being covered by the provisioning profile.",
  eligible_with_warnings: "Passed the core checks but has conditions you should read below.",
  not_eligible: "This build cannot be installed from this platform in its current state.",
  needs_review: "The evidence is not strong enough to say whether this build is installable. An administrator should review it.",
};
export function EligibilityPanel({ b, report }: { b: Pick<BuildDto, "eligibility_status" | "validation_status" | "distribution_method">; report?: ReportDto | null }) {
  const tone = b.eligibility_status === "eligible" ? "good" : b.eligibility_status === "not_eligible" ? "bad" : "warn";
  return (
    <Card title="Distribution eligibility" actions={<StatusBadge status={b.eligibility_status} />}>
      <div className="space-y-3">
        <Callout tone={tone}>{b.validation_status !== "completed" ? "Eligibility is unknown until validation completes." : ELIG_COPY[b.eligibility_status]}</Callout>
        {report && (<ul className="list-disc space-y-1 pl-5 text-[13px]">{[...report.errors.map((e) => e.message), ...report.warnings].map((w, i) => <li key={i}>{w}</li>)}</ul>)}
        <p className="text-xs muted">A QR code or hosted link does not bypass Apple signing, provisioning, device registration or review. Download or open events are not proof of installation.</p>
      </div>
    </Card>
  );
}

function RegisteredDevices({ count, devices }: { count: number | null; devices: string[] | null }) {
  const [open, setOpen] = React.useState(false); const [f, setF] = React.useState(""); const [copied, setCopied] = React.useState(false);
  if (!devices) return <span>{count ?? "?"} <span className="text-[var(--text-2)]">(list not stored for this build — use Re-validate to load it)</span></span>;
  const shown = devices.filter((d) => d.toLowerCase().includes(f.trim().toLowerCase()));
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="font-medium text-[var(--accent)] underline underline-offset-2">{devices.length} {open ? "(hide list)" : "(click to show all)"}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={f} onChange={(e) => setF(e.target.value)} placeholder="Search a device ID…" aria-label="Search device IDs" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-[13px]" />
            <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[13px]" onClick={() => { void navigator.clipboard?.writeText(devices.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy all"}</button>
          </div>
          <ol className="max-h-72 overflow-auto rounded-lg border border-[var(--border)] p-2 text-xs">{shown.map((d) => <li key={d} className="py-0.5 font-mono break-all">{d}</li>)}{!shown.length && <li className="text-[var(--text-2)]">No match.</li>}</ol>
          <p className="text-xs text-[var(--text-2)]">{shown.length} of {devices.length} shown. Only project staff can see this list.</p>
        </div>
      )}
    </div>
  );
}

export function ValidationSummary({ report }: { report: ReportDto }) {
  const p = report.profile; const s = report.signing;
  return (
    <div className="space-y-4">
      <Card title="Signing & provisioning (summary)">
        <KV items={[["Signature verification", <StatusBadge key="v" status={s.verification === "valid" ? "good" : s.verification === "invalid" || s.verification === "unsigned" ? "failed" : "needs_review"}>{label(s.verification ?? "not performed")}</StatusBadge>], ["Signing identity", s.identitySummary], ["Team identifier", s.teamIdentifier ?? p.teamIdentifier],
          ["Profile type", label(p.profileType ?? "none")], ["Profile present", p.present ? "Yes" : "No"], ["Profile expires", fmtDate(p.expiresAt)], ["Registered devices", p.deviceRegistrationRequired ? <RegisteredDevices key="rd" count={p.deviceCount ?? null} devices={p.devices ?? null} /> : "Not device-restricted"],
          ["App ID matches bundle", p.appIdMatchesBundle == null ? "Unknown" : p.appIdMatchesBundle ? "Yes" : "No"], ["get-task-allow", report.entitlements.getTaskAllow == null ? "—" : String(report.entitlements.getTaskAllow)], ["Push environment", report.entitlements.apsEnvironment], ["Entitlement keys", report.entitlements.keys?.length ?? 0]]} />
      </Card>
      <Card title="Checks performed">
        <ul className="divide-y divide-[var(--border)]">{report.checks.map((c, i) => (<li key={i} className="flex items-start gap-2 py-2 text-[13px]">{c.status === "passed" ? <ShieldCheck className="mt-0.5 h-4 w-4 text-[var(--good)]" aria-label="passed" /> : c.status === "failed" ? <X className="mt-0.5 h-4 w-4 text-[var(--bad)]" aria-label="failed" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--warn)]" aria-label={c.status} />}<div><code className="text-xs">{c.code}</code><p>{c.message}</p></div></li>))}</ul>
      </Card>
      <Card title="Limitations of this validation"><ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--text-2)]">{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></Card>
    </div>
  );
}

// ---------------------------------------------------------------- QR + links
export function QRCodePanel({ linkId, url }: { linkId: string; url: string }) {
  const [svg, setSvg] = React.useState(""); const [err, setErr] = React.useState("");
  React.useEffect(() => { fetch(`/api/v1/distribution-links/${linkId}/qr?format=svg`).then(async (r) => { if (!r.ok) throw new Error(((await r.json()) as { error?: { message?: string } }).error?.message); setSvg(await r.text()); }).catch((e) => setErr(e.message)); }, [linkId]);
  return (
    <div className="space-y-3">
      {err ? <Callout tone="warn">{err}</Callout> : svg ? <div className="mx-auto w-48 rounded-lg border border-[var(--border)] bg-white p-1" role="img" aria-label="QR code for the distribution page" dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"') }} /> : <div className="skeleton mx-auto h-48 w-48" />}
      <div className="flex flex-wrap justify-center gap-2">
        <a href={`/api/v1/distribution-links/${linkId}/qr?format=png`} download><Button size="sm" disabled={!svg}><Download className="h-4 w-4" />PNG</Button></a>
        <a href={`/api/v1/distribution-links/${linkId}/qr?format=svg`} download><Button size="sm" disabled={!svg}><Download className="h-4 w-4" />SVG</Button></a>
        <a href={`/app/distribution/${linkId}/print`} target="_blank" rel="noreferrer"><Button size="sm" disabled={!svg}><QrCode className="h-4 w-4" />Print page</Button></a>
      </div>
      <p className="text-center text-xs muted">The QR encodes the protected page URL, not a file. It stops working when the link is revoked or expires.</p>
      <span className="sr-only">{url}</span>
    </div>
  );
}
export function CopyButton({ text, label: l = "Copy link" }: { text: string; label?: string }) {
  const toast = useToast();
  return <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(text); toast("ok", "Copied to clipboard"); } catch { toast("err", "Copy failed — select the link and copy manually."); } }}><Copy className="h-4 w-4" />{l}</Button>;
}

export interface LinkDto { kind?: "install" | "preview"; id: string; title: string; access_scope: string; state: string; expires_at: string | null; max_downloads: number | null; download_count: number; password_protected: boolean; allow_download: number; allow_feedback: number; url?: string; created_at: string; build_id: string }
export function DistributionLinkCard({ l, onRevoke, href }: { l: LinkDto; onRevoke?: () => void; href?: string }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0"><div className="flex items-center gap-2"><a className="truncate font-medium" style={{ color: "var(--text)" }} href={href ?? `/app/distribution/${l.id}`}>{l.title}</a><StatusBadge status={l.state} /></div>
        <p className="mt-1 text-xs muted">{label(l.access_scope)} · {l.password_protected ? "password protected · " : ""}expires {l.expires_at ? fmtDate(l.expires_at) : "never"} · {l.download_count}{l.max_downloads ? `/${l.max_downloads}` : ""} downloads</p></div>
      <div className="flex gap-2">{l.url && l.state === "active" && <CopyButton text={l.url} />}{onRevoke && l.state !== "revoked" && <Button size="sm" variant="danger" onClick={onRevoke}>Revoke</Button>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- dropzone
export function FileDropzone({ file, onFile, disabled, accept = ".ipa", prompt = "Drag and drop an already-signed .ipa here", note = "The file is uploaded as-is. This platform never re-signs or modifies an IPA.", ariaLabel = "Choose IPA file", packApp = false }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean; accept?: string; prompt?: string; note?: string; ariaLabel?: string; packApp?: boolean }) {
  const [over, setOver] = React.useState(false); const input = React.useRef<HTMLInputElement>(null); const folder = React.useRef<HTMLInputElement>(null);
  const [pack, setPack] = React.useState<{ name: string; pct: number } | null>(null); const [msg, setMsg] = React.useState("");
  async function packIt(app: Awaited<ReturnType<typeof collectApp>> | ReturnType<typeof appFromFileList>) {
    if ("error" in app) { setMsg(app.error); return; }
    setMsg(""); setPack({ name: app.name, pct: 0 });
    try { const f = await packAppZip(app, (d, t) => setPack({ name: app.name, pct: Math.round((d / t) * 100) })); onFile(f); } catch { setMsg("Could not pack the folder. Compress the .app to a .zip and drop that instead."); }
    setPack(null);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setOver(false); if (disabled) return;
    // Entries must be read synchronously inside the event.
    const item = packApp ? e.dataTransfer.items?.[0] : undefined;
    const entry = item && (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
    if (entry && (entry as { isDirectory?: boolean }).isDirectory) { void collectApp(entry).then(packIt); return; }
    if (e.dataTransfer.files[0]) { setMsg(""); onFile(e.dataTransfer.files[0]); }
  }
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cx("flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center", over ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-strong)]")}>
      <FileUp className="h-8 w-8 text-[var(--text-3)]" aria-hidden />
      {pack ? <div className="w-full max-w-xs space-y-2" role="status"><p className="font-medium">Packing {pack.name}.app…</p><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pack.pct}%` }} /></div></div>
        : file ? <p className="font-medium">{file.name} <span className="muted">({fmtBytes(file.size)})</span></p> : <p className="font-medium">{prompt}</p>}
      <p className="text-xs muted">{note}</p>
      {msg && <p className="text-[13px] text-[var(--bad)]" role="alert">{msg}</p>}
      <input ref={input} type="file" accept={accept} className="sr-only" aria-label={ariaLabel} disabled={disabled} onChange={(e) => { setMsg(""); onFile(e.target.files?.[0] ?? null); }} />
      {packApp && <input ref={folder} type="file" className="sr-only" aria-label="Choose the .app folder" disabled={disabled} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { if (e.target.files?.length) void packIt(appFromFileList(e.target.files)); e.target.value = ""; }} />}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => input.current?.click()} disabled={disabled || !!pack}>{file ? "Choose a different file" : "Choose file"}</Button>
        {packApp && <Button onClick={() => folder.current?.click()} disabled={disabled || !!pack}>Choose .app folder</Button>}
      </div>
    </div>
  );
}
export function UploadProgress({ phase, percent, message, onCancel }: { phase: string; percent: number; message: string; onCancel?: () => void }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-[13px]"><span>{message}</span><span className="tabular-nums">{percent}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className={cx("h-full bg-[var(--accent)] transition-all", phase === "error" && "bg-[var(--bad)]")} style={{ width: `${percent}%` }} /></div>
      {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel upload</Button>}
    </div>
  );
}

// ---------------------------------------------------------------- feedback
export const CATEGORIES = ["crash", "ui_layout", "performance", "functional", "installation", "compatibility", "other"];
export function FeedbackForm({ projectId, builds, defaultBuildId, onDone }: { projectId: string; builds: { id: string; version: string | null; build_number: string | null }[]; defaultBuildId?: string; onDone?: (id: string) => void }) {
  const [f, setF] = React.useState({ buildId: defaultBuildId ?? "", category: "functional", severity: "medium", title: "", description: "", reproductionSteps: "", expectedResult: "", actualResult: "", deviceModel: "", iosVersion: "", contactPreference: "in_app" });
  const [files, setFiles] = React.useState<File[]>([]); const [err, setErr] = React.useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = useAct(async () => {
    const created = await apiFetch<{ id: string }>(`/projects/${projectId}/feedback`, { body: { ...f, buildId: f.buildId || null } });
    for (const file of files) {
      const s = await apiFetch<{ attachmentId: string; uploadPath: string }>(`/feedback/${created.id}/attachments/upload-session`, { body: { filename: file.name, mimeType: file.type, sizeBytes: file.size } });
      await fetch(s.uploadPath, { method: "PUT", body: file, headers: { "content-length": String(file.size) } }).then(async (r) => { if (!r.ok) throw new Error(((await r.json()) as { error?: { message?: string } }).error?.message ?? "Attachment upload failed"); });
    }
    return created;
  }, { ok: "Feedback submitted. Thank you!", onSuccess: (c) => onDone?.(c.id) });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErr(""); if (f.title.trim().length < 3 || f.description.trim().length < 3) return setErr("Add a title and description."); submit.mutate(); }}>
      {err && <Callout tone="bad">{err}</Callout>}
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Build" htmlFor="fb-build"><Select id="fb-build" value={f.buildId} onChange={set("buildId")}><option value="">Not build-specific</option>{builds.map((b) => <option key={b.id} value={b.id}>{b.version ?? "?"} ({b.build_number ?? "?"})</option>)}</Select></FormField>
        <FormField label="Category" htmlFor="fb-cat"><Select id="fb-cat" value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c).replace("Ui layout", "UI / Layout")}</option>)}</Select></FormField>
        <FormField label="Severity" htmlFor="fb-sev"><Select id="fb-sev" value={f.severity} onChange={set("severity")}>{["critical", "high", "medium", "low"].map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></FormField>
      </div>
      <FormField label="Title" htmlFor="fb-title"><Input id="fb-title" maxLength={200} value={f.title} onChange={set("title")} /></FormField>
      <FormField label="Description" htmlFor="fb-desc"><Textarea id="fb-desc" value={f.description} onChange={set("description")} /></FormField>
      <FormField label="Steps to reproduce" htmlFor="fb-steps"><Textarea id="fb-steps" value={f.reproductionSteps} onChange={set("reproductionSteps")} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2"><FormField label="Expected result" htmlFor="fb-exp"><Textarea id="fb-exp" value={f.expectedResult} onChange={set("expectedResult")} /></FormField><FormField label="Actual result" htmlFor="fb-act"><Textarea id="fb-act" value={f.actualResult} onChange={set("actualResult")} /></FormField></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Device model (optional)" htmlFor="fb-dev"><Input id="fb-dev" placeholder="iPhone 15 Pro" value={f.deviceModel} onChange={set("deviceModel")} /></FormField>
        <FormField label="iOS version (optional)" htmlFor="fb-ios"><Input id="fb-ios" placeholder="18.1" value={f.iosVersion} onChange={set("iosVersion")} /></FormField>
        <FormField label="Contact preference" htmlFor="fb-contact"><Select id="fb-contact" value={f.contactPreference} onChange={set("contactPreference")}><option value="in_app">In-app updates</option><option value="email">Email</option><option value="none">Don&apos;t contact me</option></Select></FormField>
      </div>
      <FormField label="Screenshots (PNG, JPEG, WebP, GIF or HEIC · up to 6)" htmlFor="fb-files" hint="Types are verified on the server by file content, not just the extension.">
        <input id="fb-files" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/heic" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))} />
      </FormField>
      <Button type="submit" variant="primary" loading={submit.isPending}>Submit feedback</Button>
    </form>
  );
}

export function FeedbackStatusTimeline({ history }: { history: { id: string; old_status: string | null; new_status: string; note: string | null; created_at: string; changed_by_name: string | null }[] }) {
  return (
    <ol className="space-y-3 border-l border-[var(--border-strong)] pl-4">
      {history.map((h) => (<li key={h.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden /><div className="flex flex-wrap items-center gap-2"><StatusBadge status={h.new_status} /><span className="text-xs muted">{h.changed_by_name ?? "System"} · {ago(h.created_at)}</span></div>{h.note && <p className="mt-1 text-[13px] text-[var(--text-2)]">{h.note}</p>}</li>))}
    </ol>
  );
}
