"use client";
import { Download, CheckCircle2, Smartphone } from "lucide-react";
import { PageHeader, Card, EmptyState, Callout } from "@/components/ui";
import { Async, useApi } from "@/components/features";

interface Ev { id: string; event_type: string; created_at: string; build_id: string; version: string | null; build_number: string | null; app_name: string | null; release_title: string | null; project_name: string }
const EVENT: Record<string, { text: string; icon: typeof Download; tone: string }> = {
  manifest_requested: { text: "Install started", icon: Smartphone, tone: "text-[var(--accent)]" },
  download_started: { text: "Download started", icon: Download, tone: "text-[var(--accent)]" },
  install_confirmed: { text: "Reported as installed", icon: CheckCircle2, tone: "text-[var(--good)]" },
};
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
function dayLabel(iso: string) {
  const d = new Date(iso); const t = new Date(); const y = new Date(Date.now() - 86400000);
  if (dayKey(iso) === dayKey(t.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(y.toISOString())) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function History() {
  const q = useApi<Ev[]>(["portal-dl"], "/portal/downloads");
  return (<><PageHeader title="History" description="Every install and download you have started, newest first." />
    <Async q={q}>{(rows) => {
      if (!rows.length) return <Card><EmptyState title="Nothing here yet" body="When you install a build from Available builds, it will show up here." /></Card>;
      const groups: { key: string; label: string; items: Ev[] }[] = [];
      for (const r of rows) { const k = dayKey(r.created_at); const g = groups[groups.length - 1]; if (g && g.key === k) g.items.push(r); else groups.push({ key: k, label: dayLabel(r.created_at), items: [r] }); }
      return (
        <div className="space-y-5">
          <Callout tone="info">&ldquo;Install started&rdquo; and &ldquo;Download started&rdquo; mean you began the process. Apple doesn&apos;t tell us whether an installation finished.</Callout>
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-3)]">{g.label}</h2>
              <ul className="card divide-y divide-[var(--border)] overflow-hidden">
                {g.items.map((r) => { const e = EVENT[r.event_type] ?? { text: r.event_type.replace(/_/g, " "), icon: Download, tone: "" }; const Icon = e.icon; return (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] ${e.tone}`}><Icon className="h-5 w-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.app_name ?? r.project_name} <span className="font-normal text-[var(--text-2)]">{r.version ?? ""} ({r.build_number ?? "?"})</span></p><p className="truncate text-[13px] text-[var(--text-2)]">{e.text} · {r.project_name}</p></div>
                    <time dateTime={r.created_at} className="shrink-0 text-[13px] text-[var(--text-3)]">{new Date(r.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
                  </li>); })}
              </ul>
            </section>))}
        </div>);
    }}</Async></>);
}
