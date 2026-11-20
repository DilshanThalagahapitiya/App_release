"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { PageHeader, Card, KV, StatusBadge, Button, ConfirmDialog } from "@/components/ui";
import { Async, useApi, useAct, QRCodePanel, CopyButton, type LinkDto } from "@/components/features";
import { apiFetch, fmtDate, label } from "@/lib/client";

export default function LinkDetail() {
  const { linkId } = useParams<{ linkId: string }>();
  const q = useApi<LinkDto & { events: Record<string, number>; members: { id: string; display_name: string }[]; build: { id: string; version: string | null; build_number: string | null } }>(["link", linkId], `/distribution-links/${linkId}`, { refetchInterval: 10000 });
  const [rev, setRev] = React.useState(false);
  const revoke = useAct(() => apiFetch(`/distribution-links/${linkId}/revoke`, { method: "POST" }), { ok: "Link revoked", invalidate: [["link", linkId]], onSuccess: () => setRev(false) });
  return (<Async q={q}>{(l) => (<>
    <PageHeader title={l.title} breadcrumbs={[{ label: "Distribution", href: "/app/distribution" }, { label: l.title }]} description={<StatusBadge status={l.state} />} actions={<>{l.url && l.state === "active" && <CopyButton text={l.url} />}<a href={`/app/builds/${l.build_id}/distribution`}><Button>Build links</Button></a>{l.state !== "revoked" && <Button variant="danger" onClick={() => setRev(true)}>Revoke</Button>}</>} />
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Link settings"><KV items={[["Build", `${l.build.version ?? "?"} (${l.build.build_number ?? "?"})`], ["Access", label(l.access_scope)], ["Password", l.password_protected ? "Yes" : "No"], ["Expires", l.expires_at ? fmtDate(l.expires_at) : "Never"], ["Downloads", `${l.download_count}${l.max_downloads ? ` / ${l.max_downloads}` : ""}`], ["Feedback", l.allow_feedback ? "Allowed" : "Disabled"], ["Named users", l.members.map((m) => m.display_name).join(", ") || "—"]]} /></Card>
        <Card title="Activity (events are not installation proof)"><KV items={[["Page opens", l.events.page_open ?? 0], ["Install starts (manifest requests)", l.events.manifest_requested ?? 0], ["Downloads started", l.events.download_started ?? 0], ["Self-reported installs", l.events.install_confirmed ?? 0]]} />
          <p className="mt-3 text-xs muted">A download or manifest request only shows someone began an install. Apple does not tell this platform whether installation succeeded; “self-reported installs” come from the confirm button on the customer page.</p></Card>
      </div>
      <Card title="QR code">{l.state === "active" ? <QRCodePanel linkId={l.id} url={l.url ?? ""} /> : <p className="text-[13px] text-[var(--text-2)]">The QR code is unavailable because the link is {l.state}.</p>}</Card>
    </div>
    <ConfirmDialog open={rev} onClose={() => setRev(false)} danger title="Revoke this link?" confirmLabel="Revoke now" loading={revoke.isPending} onConfirm={() => revoke.mutate()} body="The link and QR code stop working immediately." /></>)}</Async>);
}
