export const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`;
export const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const fmtDay = (s?: string | null) => s ? new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
export function ago(s?: string | null) {
  if (!s) return "never";
  const d = (Date.now() - new Date(s).getTime()) / 1000;
  if (d < 60) return "just now"; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`; return `${Math.floor(d / 86400)}d ago`;
}
export const label = (s?: string | null) => (s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
