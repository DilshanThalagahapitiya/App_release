"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Button, EmptyState, Pagination, Callout } from "./ui";
import { Async, useAct, useApi } from "./features";
import { apiFetch, ago, label } from "@/lib/client";
import { NOTIF_TYPES } from "@/lib/notif-types";

interface N { id: string; type: string; title: string; body: string | null; email_state: string; read_at: string | null; created_at: string }
export function NotificationsList() {
  const [page, setPage] = React.useState(1);
  const res = useQuery({ queryKey: ["notifications", "list", page], queryFn: () => apiFetch<{ items: N[]; page: number; pageSize: number; total: number; unread: number }>(`/notifications?page=${page}&pageSize=20`) });
  const me = useApi<{ emailConfigured: boolean }>(["me"], "/auth/me");
  const prefs = useApi<{ event_type: string; in_app_enabled: number; email_enabled: number }[]>(["prefs"], "/notifications/preferences");
  const readAll = useAct(() => apiFetch("/notifications/read-all", { method: "POST" }), { invalidate: [["notifications"]] });
  const read = useAct((id: string) => apiFetch(`/notifications/${id}/read`, { method: "POST" }), { invalidate: [["notifications"]] });
  const setPref = useAct((v: { t: string; inApp: boolean; email: boolean }) => apiFetch("/notifications/preferences", { method: "PUT", body: { eventType: v.t, inApp: v.inApp, email: v.email } }), { invalidate: [["prefs"]] });
  return (
    <div className="space-y-5">
      {me.data && !me.data.emailConfigured && <Callout tone="warn" title="Email delivery is not configured">Notifications appear here in the app only. An administrator can configure an email provider in the platform settings.</Callout>}
      <Card title="Inbox" actions={<Button size="sm" onClick={() => readAll.mutate()}>Mark all read</Button>} className="!p-0">
        <Async q={res}>{(d) => d.items.length ? (<><ul>{d.items.map((n) => (<li key={n.id} className={`flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 ${n.read_at ? "" : "bg-[var(--accent-soft)]"}`}><div><p className="font-medium">{n.title}</p>{n.body && <p className="text-[13px] text-[var(--text-2)]">{n.body}</p>}<p className="mt-0.5 text-xs muted">{ago(n.created_at)} · {label(n.type)}{n.email_state !== "not_requested" && <> · email {n.email_state.replace("_", " ")}</>}</p></div>{!n.read_at && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>Mark read</Button>}</li>))}</ul><Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} /></>) : <EmptyState title="You're all caught up" body="Invitations, validation results, new builds and feedback updates will show up here." />}</Async>
      </Card>
      <Card title="Preferences"><table className="w-full text-[13px]"><thead><tr className="text-left text-xs muted"><th scope="col">Event</th><th scope="col">In-app</th><th scope="col">Email</th></tr></thead><tbody>
        {NOTIF_TYPES.map((t) => { const p = prefs.data?.find((x) => x.event_type === t); const inApp = p ? !!p.in_app_enabled : true; const em = p ? !!p.email_enabled : true; return (<tr key={t}><td className="py-1.5">{label(t)}</td><td><input aria-label={`${label(t)} in-app`} type="checkbox" checked={inApp} onChange={(e) => setPref.mutate({ t, inApp: e.target.checked, email: em })} /></td><td><input aria-label={`${label(t)} email`} type="checkbox" checked={em} disabled={!me.data?.emailConfigured} onChange={(e) => setPref.mutate({ t, inApp, email: e.target.checked })} /></td></tr>); })}</tbody></table>
        {me.data && !me.data.emailConfigured && <p className="mt-2 text-xs muted">Email toggles are disabled because no email provider is configured.</p>}</Card>
    </div>
  );
}
