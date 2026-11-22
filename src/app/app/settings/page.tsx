"use client";
import * as React from "react";
import { PageHeader, Card, FormField, Input, Button, Callout, StatusBadge, Select, Textarea } from "@/components/ui";
import { Async, useApi, useAct } from "@/components/features";
import { apiFetch } from "@/lib/client";

interface S { maxIpaBytes?: number; maxAttachmentBytes: number; allowedAttachmentTypes: string[]; defaultLinkExpiryDays: number; auditRetentionDays?: number; downloadEventRetentionDays?: number; validationMode?: "on" | "cloud" | "off"; emailConfigured: boolean; turnstileConfigured: boolean; canEdit: boolean }
function Platform({ s }: { s: S }) {
  const [f, setF] = React.useState({ maxIpaGb: String(((s.maxIpaBytes ?? 0) / 1024 ** 3).toFixed(2)), maxAttMb: String(Math.round(s.maxAttachmentBytes / 1024 / 1024)), types: s.allowedAttachmentTypes.join(", "), expiry: String(s.defaultLinkExpiryDays), audit: String(s.auditRetentionDays ?? 365), dl: String(s.downloadEventRetentionDays ?? 180), vmode: s.validationMode ?? "on" });
  const save = useAct(() => apiFetch("/settings", { method: "PUT", body: { maxIpaBytes: Math.round(Number(f.maxIpaGb) * 1024 ** 3), maxAttachmentBytes: Math.round(Number(f.maxAttMb) * 1024 * 1024), allowedAttachmentTypes: f.types.split(",").map((x) => x.trim()).filter(Boolean), defaultLinkExpiryDays: Number(f.expiry), auditRetentionDays: Number(f.audit), downloadEventRetentionDays: Number(f.dl), validationMode: f.vmode } }), { ok: "Platform settings saved", invalidate: [["settings"]] });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (<Card title="Platform settings (Platform Owner)"><form className="max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
    <FormField label="IPA validation" htmlFor="p0" hint="ON: a Mac worker inspects each IPA (signature, profile, expiry) before it can be published. OFF: no Mac is needed and uploads are accepted at once. The app name, bundle ID, version and provisioning profile (including its device list) are still read from the IPA, but the code signature is not verified.">
      <Select id="p0" value={f.vmode} onChange={set("vmode")}><option value="on">ON: full validation on the Mac worker</option><option value="cloud">CLOUD: check in the cloud, no Mac needed (recommended without a Mac)</option><option value="off">OFF: accept uploads without validation</option></Select></FormField>
    {f.vmode === "cloud" && <Callout tone="info" title="Cloud check">Reads Info.plist and the provisioning profile inside the cloud, so uploads are checked within seconds and the registered-device list is available. It cannot verify the code signature itself.</Callout>}
    {f.vmode === "off" && <Callout tone="warn" title="Validation is off">Builds are marked "Eligible with warnings" and the signature is not verified. A build that is not properly Ad Hoc signed, or whose profile lacks the client's device, will still fail on the iPhone. Publishing, links, installs and device collection work as usual.</Callout>}
    <FormField label="Maximum IPA size (GB)" htmlFor="p1"><Input id="p1" type="number" step="0.1" min="0.01" max="5" value={f.maxIpaGb} onChange={set("maxIpaGb")} /></FormField>
    <FormField label="Attachment size limit (MB)" htmlFor="p2"><Input id="p2" type="number" min="1" max="50" value={f.maxAttMb} onChange={set("maxAttMb")} /></FormField>
    <FormField label="Allowed attachment types" htmlFor="p3" hint="Comma separated. Only image types can be verified by content."><Input id="p3" value={f.types} onChange={set("types")} /></FormField>
    <FormField label="Default link expiry (days)" htmlFor="p4"><Input id="p4" type="number" min="1" max="365" value={f.expiry} onChange={set("expiry")} /></FormField>
    <div className="grid gap-4 sm:grid-cols-2"><FormField label="Audit log retention (days)" htmlFor="p5"><Input id="p5" type="number" min="30" value={f.audit} onChange={set("audit")} /></FormField><FormField label="Download-event retention (days)" htmlFor="p6"><Input id="p6" type="number" min="7" value={f.dl} onChange={set("dl")} /></FormField></div>
    <Button type="submit" variant="primary" loading={save.isPending}>Save</Button></form></Card>);
}
function OrgSettings() {
  const orgs = useApi<{ id: string; name: string; timezone: string; default_link_expiry_days: number; default_qa_instructions: string | null }[]>(["orgs"], "/organisations");
  const [sel, setSel] = React.useState(""); const o = orgs.data?.find((x) => x.id === sel) ?? orgs.data?.[0];
  const [f, setF] = React.useState<{ name: string; tz: string; days: string; qa: string } | null>(null);
  React.useEffect(() => { if (o) setF({ name: o.name, tz: o.timezone, days: String(o.default_link_expiry_days), qa: o.default_qa_instructions ?? "" }); }, [o?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAct(() => apiFetch(`/organisations/${o!.id}`, { method: "PATCH", body: { name: f!.name, timezone: f!.tz, default_link_expiry_days: Number(f!.days), default_qa_instructions: f!.qa } }), { ok: "Organisation settings saved", invalidate: [["orgs"]] });
  if (!o || !f) return null;
  return (<Card title="Organisation settings" actions={(orgs.data?.length ?? 0) > 1 && <Select aria-label="Organisation" className="!w-44" value={o.id} onChange={(e) => setSel(e.target.value)}>{orgs.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}>
    <form className="max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <FormField label="Organisation name" htmlFor="o1"><Input id="o1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
      <FormField label="Time zone" htmlFor="o2" hint="IANA name, e.g. Europe/London. Dates are stored in UTC."><Input id="o2" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} /></FormField>
      <FormField label="Default distribution expiry (days)" htmlFor="o3"><Input id="o3" type="number" min="1" max="365" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></FormField>
      <FormField label="Default QA instructions" htmlFor="o4"><Textarea id="o4" value={f.qa} onChange={(e) => setF({ ...f, qa: e.target.value })} /></FormField>
      <Button type="submit" variant="primary" loading={save.isPending}>Save</Button></form></Card>);
}
export default function Settings() {
  const q = useApi<S>(["settings"], "/settings");
  return (<><PageHeader title="Settings" /><div className="space-y-5">
    <Async q={q}>{(s) => (<>
      <Card title="Integrations status"><div className="space-y-2 text-[13px]">
        <p className="flex items-center gap-2"><StatusBadge status={s.emailConfigured ? "good" : "needs_review"}>{s.emailConfigured ? "Configured" : "Not configured"}</StatusBadge>Email delivery (invitations, resets, notifications)</p>
        <p className="flex items-center gap-2"><StatusBadge status={s.turnstileConfigured ? "good" : "needs_review"}>{s.turnstileConfigured ? "Enabled" : "Not configured"}</StatusBadge>Cloudflare Turnstile on sign-in</p>
        {!s.emailConfigured && <Callout tone="info">Without email, in-app notifications still work and invitation links are shown to the inviting admin to share manually. Configure EMAIL_* secrets as described in docs/operations.md.</Callout>}</div></Card>
      {s.canEdit && <Platform s={s} />}</>)}</Async>
    <OrgSettings /></div></>);
}
