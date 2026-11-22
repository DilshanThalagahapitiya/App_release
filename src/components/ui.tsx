"use client";
import * as React from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2, X, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { label } from "@/lib/client";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ---------------------------------------------------------------- buttons & fields
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean; size?: "sm" | "md"; why?: string };
export const Button = React.forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "secondary", loading, size = "md", why, className, children, disabled, ...p }, ref) {
  const v = { primary: "bg-[var(--green)] text-white hover:bg-[var(--green-hover)] border-transparent", secondary: "bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] border-[var(--border-strong)]", danger: "bg-[var(--bad)] text-white border-transparent hover:opacity-90", ghost: "bg-transparent border-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)]" }[variant];
  return (
    <button ref={ref} title={disabled && why ? why : p.title} disabled={disabled || loading} className={cx("inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition disabled:opacity-50 disabled:cursor-not-allowed", size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5", v, className)} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
});
const field = "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-3)] disabled:opacity-60";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} className={cx(field, "h-9", className)} {...p} />; });
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cx(field, "min-h-[88px]", className)} {...p} />; });
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) { return <select ref={ref} className={cx(field, "h-9 py-0", className)} {...p} />; });
export function FormField({ label: l, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[var(--text-2)]">{l}</label>
      {children}
      {hint && !error && <p className="text-xs muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-[var(--bad)]">{error}</p>}
    </div>
  );
}
export function SearchInput({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-3)]" aria-hidden />
      <Input aria-label={placeholder} className="pl-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>
  );
}

// ---------------------------------------------------------------- status
const TONES: Record<string, string> = {
  good: "bg-[var(--good-soft)] text-[var(--good)]", warn: "bg-[var(--warn-soft)] text-[var(--warn)]", bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
  info: "bg-[var(--info-soft)] text-[var(--accent)]", neutral: "bg-[var(--surface-2)] text-[var(--text-2)]",
};
const STATUS_TONE: Record<string, string> = {
  eligible: "good", eligible_with_warnings: "warn", not_eligible: "bad", needs_review: "warn",
  completed: "good", running: "info", pending: "neutral", failed: "bad", queued: "neutral", claimed: "info", cancelled: "neutral",
  published: "good", unpublished: "neutral", archived: "neutral", active: "good", revoked: "bad", expired: "warn", exhausted: "warn", draft: "neutral",
  new: "info", triaged: "info", in_progress: "info", need_more_info: "warn", resolved: "good", closed: "neutral",
  critical: "bad", high: "bad", medium: "warn", low: "neutral", online: "good", offline: "bad", paused: "warn",
  uploading: "info", processing: "info", ready: "good", disabled: "neutral", deleted: "neutral",
};
export function StatusBadge({ status, children }: { status: string; children?: React.ReactNode }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const icon = tone === "good" ? "●" : tone === "bad" ? "▲" : tone === "warn" ? "◆" : "○"; // shape + text so state is never color-only
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}><span aria-hidden className="text-[9px]">{icon}</span>{children ?? label(status)}</span>;
}

// ---------------------------------------------------------------- layout atoms
export function Card({ children, className, title, actions }: { children: React.ReactNode; className?: string; title?: string; actions?: React.ReactNode }) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2><div className="flex gap-2">{actions}</div></header>}
      <div className="p-4">{children}</div>
    </section>
  );
}
export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-5 space-y-2">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-1 text-[var(--text-2)]">{description}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-[var(--text-3)]">
      {items.map((it, i) => (<React.Fragment key={i}>{i > 0 && <span aria-hidden>/</span>}{it.href ? <a className="hover:underline" href={it.href} style={{ color: "inherit" }}>{it.label}</a> : <span aria-current="page">{it.label}</span>}</React.Fragment>))}
    </nav>
  );
}
export function StatCard({ label: l, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href?: string }) {
  const body = (<div className="card p-4"><p className="text-xs font-medium text-[var(--text-3)]">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="mt-0.5 text-xs muted">{hint}</p>}</div>);
  return href ? <a href={href} style={{ color: "inherit", textDecoration: "none" }}>{body}</a> : body;
}
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (<div className="flex flex-col items-center gap-2 px-6 py-12 text-center"><Inbox className="h-8 w-8 text-[var(--text-3)]" aria-hidden /><p className="font-medium">{title}</p>{body && <p className="max-w-md text-[var(--text-2)]">{body}</p>}{action && <div className="mt-2">{action}</div>}</div>);
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  const denied = (error as { status?: number })?.status === 403 || (error as { status?: number })?.status === 404;
  return (<div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center"><AlertCircle className="h-8 w-8 text-[var(--bad)]" aria-hidden /><p className="font-medium">{denied ? "You don't have access to this" : "Couldn't load this"}</p><p className="text-[var(--text-2)]">{msg}</p>{retry && <Button onClick={retry}>Try again</Button>}</div>);
}
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (<div aria-busy="true" aria-label="Loading" className="space-y-3 p-4">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>);
}
export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "good"; title?: string; children: React.ReactNode }) {
  return (<div role={tone === "bad" ? "alert" : "note"} className={cx("rounded-lg px-3.5 py-3 text-[13px]", TONES[tone])}>{title && <p className="mb-0.5 font-semibold">{title}</p>}<div className="text-[var(--text)]">{children}</div></div>);
}

// ---------------------------------------------------------------- tables
export interface Col<T> { key: string; header: string; cell: (r: T) => React.ReactNode; className?: string; hideOnMobile?: boolean }
export function DataTable<T extends { id?: string }>({ cols, rows, onRowHref, empty, caption }: { cols: Col<T>[]; rows: T[]; onRowHref?: (r: T) => string; empty?: React.ReactNode; caption?: string }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--text-3)]">{cols.map((c) => <th key={c.key} scope="col" className={cx("px-4 py-2 font-medium", c.hideOnMobile && "hidden md:table-cell", c.className)}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id ?? i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
            {cols.map((c, ci) => <td key={c.key} className={cx("px-4 py-2.5 align-middle", c.hideOnMobile && "hidden md:table-cell", c.className)}>{ci === 0 && onRowHref ? <a href={onRowHref(r)} className="font-medium" style={{ color: "var(--text)" }}>{c.cell(r)}</a> : c.cell(r)}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--text-3)]">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
    </div>
  );
}
export function FilterBar({ children }: { children: React.ReactNode }) { return <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-3">{children}</div>; }

// ---------------------------------------------------------------- dialogs & toasts
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus effect: parents pass a new inline function on every
  // render (every keystroke), which used to steal focus from the field being typed in.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),select:not([disabled])") ?? root?.querySelector<HTMLElement>("footer button"))?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", h);
    return () => { document.removeEventListener("keydown", h); prev?.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="card max-h-[90vh] w-full overflow-auto sm:max-w-lg">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="font-semibold">{title}</h2><button aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-[var(--surface-2)]"><X className="h-4 w-4" /></button></header>
        <div className="space-y-4 p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: React.ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean }) {
  return (<Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}><div className="text-[var(--text-2)]">{body}</div></Modal>);
}

type Toast = { id: number; kind: "ok" | "err"; text: string };
const ToastCtx = React.createContext<(kind: "ok" | "err", text: string) => void>(() => undefined);
export const useToast = () => React.useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "err" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>{children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2">
        {items.map((t) => (<div key={t.id} role={t.kind === "err" ? "alert" : "status"} className="card flex items-start gap-2 px-3.5 py-2.5">{t.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--good)]" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--bad)]" />}<span>{t.text}</span></div>))}
      </div>
    </ToastCtx.Provider>
  );
}
export function Tabs({ tabs, active }: { tabs: { label: string; href: string; key: string }[]; active: string }) {
  return (<nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]">{tabs.map((t) => (<a key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined} className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium", t.key === active ? "border-[var(--accent)] text-[var(--text)]" : "border-transparent text-[var(--text-3)] hover:text-[var(--text)]")} style={{ textDecoration: "none", color: t.key === active ? "var(--text)" : undefined }}>{t.label}</a>))}</nav>);
}
export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (<dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([k, v]) => (<div key={k} className="min-w-0"><dt className="text-xs text-[var(--text-3)]">{k}</dt><dd className="mt-0.5 break-words font-medium">{v ?? "—"}</dd></div>))}</dl>);
}
export { cx };
