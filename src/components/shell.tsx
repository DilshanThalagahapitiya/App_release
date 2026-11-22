"use client";
import * as React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Bell, Box, ChevronsLeft, ChevronsRight, FolderKanban, Gauge, LogOut, Menu, Moon, Package, ScrollText, Server, Settings, Share2, Sun, MessageSquare, Users, Building2, History, UserCircle, X } from "lucide-react";
import { apiFetch, ago } from "@/lib/client";
import { Button, cx, StatusBadge } from "./ui";
import { Brand } from "./brand";
import { BackButton, InstallHint } from "./app-bits";

export interface Me { id: string; email: string; displayName: string; isPlatformOwner: boolean; memberships: { organisation_id: string; name: string; role: string }[]; portal: "admin" | "customer"; unreadNotifications: number; emailConfigured: boolean }
type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; ownerOnly?: boolean; adminOnly?: boolean };

const ADMIN: Item[] = [
  { href: "/app", label: "Overview", icon: Gauge }, { href: "/app/organisations", label: "Organisations", icon: Building2, ownerOnly: true },
  { href: "/app/projects", label: "Projects", icon: FolderKanban }, { href: "/app/builds", label: "Builds", icon: Package },
  { href: "/app/distribution", label: "Distribution", icon: Share2 }, { href: "/app/members", label: "Customers / Members", icon: Users, adminOnly: true },
  { href: "/app/feedback", label: "QA Feedback", icon: MessageSquare }, { href: "/app/audit-logs", label: "Activity / Audit Logs", icon: ScrollText, adminOnly: true },
  { href: "/app/workers", label: "Worker & Processing", icon: Server, ownerOnly: true }, { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/app/settings", label: "Settings", icon: Settings },
];
const CUSTOMER: Item[] = [
  { href: "/portal", label: "My Projects", icon: FolderKanban }, { href: "/portal/builds", label: "Available Builds", icon: Package },
  { href: "/portal/downloads", label: "History", icon: History }, { href: "/portal/feedback", label: "QA Feedback", icon: MessageSquare },
  { href: "/portal/notifications", label: "Notifications", icon: Bell }, { href: "/portal/profile", label: "Profile / Account", icon: UserCircle },
];

const parentOf = (p: string) => { const a = p.split("/").filter(Boolean); a.pop(); return "/" + a.join("/") || "/"; };
function setTheme(t: "light" | "dark") { document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch { /* storage may be unavailable */ } }

export function AppShell({ me, area, children }: { me: Me; area: "admin" | "customer"; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobile, setMobile] = React.useState(false);
  const [path, setPath] = React.useState("");
  React.useEffect(() => {
    setPath(location.pathname);
    try { const t = localStorage.getItem("theme"); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; setCollapsed(localStorage.getItem("nav") === "1"); } catch { /* ignore */ }
  }, []);
  const items = (area === "admin" ? ADMIN : CUSTOMER).filter((i) => (!i.ownerOnly || me.isPlatformOwner) && (!i.adminOnly || me.isPlatformOwner || me.memberships.some((m) => m.role === "org_admin")));
  const active = (h: string) => (h === "/app" || h === "/portal" ? path === h : path === h || path.startsWith(h + "/"));
  const roots = items.map((i) => i.href);
  const isRoot = !path || roots.includes(path) || path === "/app" || path === "/portal";
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {items.map((i) => (
        <a key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} title={collapsed ? i.label : undefined}
          className={cx("flex items-center gap-3 px-3.5 py-2.5 text-[14px] font-medium", active(i.href) ? "border-l-[3px] border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-l-[3px] border-transparent text-[var(--text)] hover:bg-[var(--surface-2)]")} style={{ textDecoration: "none" }}>
          <i.icon className="h-4 w-4 shrink-0" /><span className={cx(collapsed && "lg:sr-only")}>{i.label}</span>
        </a>))}
    </nav>
  );
  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-[var(--surface)] focus:p-2">Skip to content</a>
      <aside className={cx("sticky top-0 hidden h-screen shrink-0 flex-col bar-accent border-r border-[var(--border)] bg-[var(--surface)] lg:flex", collapsed ? "w-14" : "w-60")}>
        <div className="flex h-16 items-center px-3.5">{collapsed ? <Box className="h-5 w-5 text-[var(--accent)]" /> : <Brand />}</div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <button onClick={() => { setCollapsed(!collapsed); try { localStorage.setItem("nav", collapsed ? "0" : "1"); } catch { /* ignore */ } }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="m-2 flex items-center justify-center rounded-lg p-2 text-[var(--text-3)] hover:bg-[var(--surface-2)]">{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</button>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-[var(--surface)] shadow-xl"><div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4"><Brand /><button aria-label="Close menu" onClick={() => setMobile(false)}><X className="h-5 w-5" /></button></div>{nav}</div>
        </div>)}
      <div className="min-w-0 flex-1">
        <header className="bar-accent safe-t sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 bg-[var(--surface)]/95 px-4 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <span className="lg:hidden">{isRoot ? <Brand subtitle={false} /> : <BackButton fallback={parentOf(path)} />}</span>
            <span className="hidden truncate text-[13px] text-[var(--text-2)] lg:inline">{me.isPlatformOwner ? "Platform Owner" : me.memberships.map((m) => m.name).join(", ") || "No organisation"}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle /><NotificationMenu area={area} unread={me.unreadNotifications} /><UserMenu me={me} />
          </div>
        </header>
        <TopTabs items={items} active={active} onMore={() => setMobile(true)} />
        <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-6 md:pt-5 lg:pt-6"><div className="mb-4 lg:hidden"><InstallHint /></div>{children}</main>
      </div>
      <TabBar items={items} active={active} onMore={() => setMobile(true)} moreOpen={mobile} />
    </div>
  );
}

/** iPad (portrait / split view): tab bar across the top, under the title bar. */
function TopTabs({ items, active, onMore }: { items: Item[]; active: (h: string) => boolean; onMore: () => void }) {
  const main = items.filter((i) => !["/app/organisations", "/app/members", "/app/audit-logs", "/app/workers", "/app/settings", "/app/notifications", "/portal/profile", "/portal/notifications", "/app/distribution"].includes(i.href)).slice(0, 4);
  return (
    <nav aria-label="Sections" className="sticky top-14 z-20 hidden border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 backdrop-blur md:block lg:hidden">
      <div className="mx-auto flex max-w-3xl gap-1 py-2">
        {main.map((i) => (
          <a key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={cx("flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-[15px] font-medium", active(i.href) ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-2)]")} style={{ textDecoration: "none" }}>
            <i.icon className="h-5 w-5" />{i.label.split(" / ")[0].replace("QA ", "")}
          </a>))}
        <button type="button" onClick={onMore} className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-[15px] font-medium text-[var(--text-2)]"><Menu className="h-5 w-5" />More</button>
      </div>
    </nav>
  );
}

/** Bottom tab bar for phones and iPad portrait (hidden on wide screens, where the sidebar is shown). */
function TabBar({ items, active, onMore, moreOpen }: { items: Item[]; active: (h: string) => boolean; onMore: () => void; moreOpen: boolean }) {
  const main = items.filter((i) => !["/app/organisations", "/app/members", "/app/audit-logs", "/app/workers", "/app/settings", "/app/notifications", "/portal/profile", "/portal/notifications", "/app/distribution"].includes(i.href)).slice(0, 4);
  const moreActive = !moreOpen && !main.some((i) => active(i.href)) && items.some((i) => active(i.href));
  const tab = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium";
  return (
    <nav aria-label="Tabs" className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-xl">
        {main.map((i) => (
          <a key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={cx(tab, active(i.href) ? "text-[var(--accent)]" : "text-[var(--text-3)]")} style={{ textDecoration: "none" }}>
            <i.icon className="h-6 w-6" /><span className="max-w-full truncate px-1">{i.label.split(" / ")[0].replace("QA ", "")}</span>
          </a>))}
        <button type="button" onClick={onMore} aria-label="More" className={cx(tab, moreActive || moreOpen ? "text-[var(--accent)]" : "text-[var(--text-3)]")}><Menu className="h-6 w-6" /><span>More</span></button>
      </div>
    </nav>
  );
}

function ThemeToggle() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  return <Button variant="ghost" size="sm" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => { setTheme(dark ? "light" : "dark"); setDark(!dark); }}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>;
}

export function NotificationMenu({ area, unread }: { area: "admin" | "customer"; unread: number }) {
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications", "menu"], queryFn: () => apiFetch<{ items: { id: string; title: string; created_at: string; read_at: string | null; resource_type: string | null; resource_id: string | null; type: string }[]; unread: number }>("/notifications?pageSize=6"), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const count = q.data?.unread ?? unread;
  const base = area === "admin" ? "/app" : "/portal";
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" aria-label={`Notifications${count ? `, ${count} unread` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell className="h-4 w-4" />{count > 0 && <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-[var(--accent-text)]">{count > 99 ? "99+" : count}</span>}</Button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-80 max-w-[90vw]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2"><span className="text-[13px] font-semibold">Notifications</span><button className="text-xs" onClick={() => readAll.mutate()}>Mark all read</button></div>
          <ul className="max-h-80 overflow-auto">{(q.data?.items ?? []).map((n) => (<li key={n.id} className={cx("border-b border-[var(--border)] px-3 py-2 text-[13px] last:border-0", !n.read_at && "bg-[var(--accent-soft)]")}>{n.title}<div className="text-xs muted">{ago(n.created_at)}</div></li>))}{!q.data?.items.length && <li className="px-3 py-6 text-center text-[13px] muted">{q.isLoading ? "Loading…" : "You're all caught up."}</li>}</ul>
          <a href={`${base}/notifications`} className="block border-t border-[var(--border)] px-3 py-2 text-center text-[13px]">View all</a>
        </div>)}
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = React.useState(false);
  const out = useMutation({ mutationFn: () => apiFetch("/auth/logout", { method: "POST" }), onSettled: () => { location.href = "/auth/login"; } });
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">{me.displayName.slice(0, 1).toUpperCase()}</span><span className="hidden text-[14px] font-medium sm:inline">{me.displayName}</span></span></Button>
      {open && (
        <div role="menu" className="card absolute right-0 z-50 mt-2 w-64 p-1">
          <div className="px-3 py-2"><p className="truncate font-medium">{me.displayName}</p><p className="truncate text-xs muted">{me.email}</p>{me.isPlatformOwner && <div className="mt-1"><StatusBadge status="info">Platform Owner</StatusBadge></div>}</div>
          <a role="menuitem" href={me.portal === "admin" ? "/app/settings" : "/portal/profile"} className="block rounded px-3 py-2 hover:bg-[var(--surface-2)]" style={{ color: "var(--text)", textDecoration: "none" }}>Account & settings</a>
          <button role="menuitem" onClick={() => out.mutate()} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--surface-2)]"><LogOut className="h-4 w-4" />Sign out</button>
        </div>)}
    </div>
  );
}

