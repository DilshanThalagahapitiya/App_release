"use client";
import * as React from "react";
import { BackButton, InstallHint } from "./app-bits";
import { CircleHelp, Download, FileText, MessageSquare, PackageCheck, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { install: Download, notes: FileText, feedback: MessageSquare, help: CircleHelp };
export interface FrameTab { id: string; label: string; icon: keyof typeof ICONS; content: React.ReactNode }

/**
 * Native-app style frame for customer-facing pages.
 * iPhone: translucent title bar + bottom tab bar. iPad / wider: top tab bar (segmented, under the title bar).
 */
export function AppFrame({ title, tabs, initial }: { title: string; tabs: FrameTab[]; initial?: string }) {
  const [active, setActive] = React.useState(initial && tabs.some((t) => t.id === initial) ? initial : tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const select = (id: string) => { setActive(id); try { window.scrollTo({ top: 0 }); } catch { /* ignore */ } };
  const many = tabs.length > 1;
  const [canBack, setCanBack] = React.useState(false);
  React.useEffect(() => { setCanBack(history.length > 1); }, []);
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="safe-t sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-center px-4">
          {canBack ? <span className="absolute left-2"><BackButton /></span> : <span className="absolute left-4 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-white" aria-hidden><PackageCheck className="h-4 w-4" /></span>}
          <h1 className="max-w-[60%] truncate text-[17px] font-semibold">{title}</h1>
        </div>
        {many && (
          <div className="mx-auto hidden max-w-2xl px-4 pb-2 md:block">
            <div role="tablist" aria-label="Sections" className="flex rounded-xl bg-[var(--surface-2)] p-1">
              {tabs.map((t) => { const I = ICONS[t.icon]; const on = t.id === current.id; return (
                <button key={t.id} role="tab" aria-selected={on} onClick={() => select(t.id)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[15px] font-medium transition ${on ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm" : "text-[var(--text-2)]"}`}><I className="h-4 w-4" />{t.label}</button>); })}
            </div>
          </div>)}
      </header>
      <main className={`mx-auto max-w-2xl space-y-4 px-4 pt-4 ${many ? "pb-28 md:pb-10" : "pb-10"}`}><InstallHint />{current.content}</main>
      {many && (
        <nav aria-label="Tabs" className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-xl">
            {tabs.map((t) => { const I = ICONS[t.icon]; const on = t.id === current.id; return (
              <button key={t.id} onClick={() => select(t.id)} aria-current={on ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-[var(--accent)]" : "text-[var(--text-3)]"}`}><I className="h-6 w-6" /><span>{t.label}</span></button>); })}
          </div>
        </nav>)}
    </div>
  );
}
