"use client";
import * as React from "react";
import { Card } from "./ui";

/**
 * Single-series bar chart: one hue (the accent), 4px rounded data-ends, recessive grid, per-bar hover
 * tooltip, and a table view for non-visual access. Empty data renders an informative empty state, never fake numbers.
 */
export function BarChart({ title, data, unit = "", emptyText }: { title: string; data: { label: string; value: number }[]; unit?: string; emptyText: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 560, H = 160, pad = 24, bw = data.length ? Math.min(28, (W - pad * 2) / data.length - 6) : 0;
  return (
    <Card title={title} actions={data.length > 0 && <button className="text-xs" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button>}>
      {!data.length ? <p className="py-8 text-center text-[13px] muted">{emptyText}</p> : table ? (
        <table className="w-full text-[13px]"><thead><tr className="text-left text-xs muted"><th scope="col">Period</th><th scope="col" className="text-right">Count</th></tr></thead><tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td className="text-right tabular-nums">{d.value}{unit}</td></tr>)}</tbody></table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`} className="w-full">
            {[0, 0.5, 1].map((t) => <line key={t} x1={pad} x2={W - pad} y1={H - t * (H - 10)} y2={H - t * (H - 10)} stroke="var(--border)" strokeWidth="1" />)}
            <text x={0} y={14} fontSize="10" fill="var(--text-3)">{max}</text>
            {data.map((d, i) => {
              const x = pad + (i + 0.5) * ((W - pad * 2) / data.length) - bw / 2; const h = (d.value / max) * (H - 10);
              return (<g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={x - 3} y={0} width={bw + 6} height={H} fill="transparent" />
                <path d={`M${x} ${H}V${H - h + 4}a4 4 0 0 1 4-4h${bw - 8}a4 4 0 0 1 4 4V${H}z`} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.55} />
                {(data.length <= 8 || i % Math.ceil(data.length / 8) === 0) && <text x={x + bw / 2} y={H + 14} fontSize="10" textAnchor="middle" fill="var(--text-3)">{d.label.slice(5)}</text>}
              </g>);
            })}
          </svg>
          {hover !== null && <div className="card pointer-events-none absolute right-2 top-0 px-2.5 py-1.5 text-xs" role="status">{data[hover].label}: <b className="tabular-nums">{data[hover].value}{unit}</b></div>}
        </div>
      )}
    </Card>
  );
}

/** Horizontal part-to-whole bars with direct value labels (text stays in text tokens, not series colour). */
export function HBars({ title, data, emptyText }: { title: string; data: { label: string; value: number }[]; emptyText: string }) {
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <Card title={title}>
      {!total ? <p className="py-8 text-center text-[13px] muted">{emptyText}</p> : (
        <ul className="space-y-2.5">{data.map((d) => (<li key={d.label} className="text-[13px]"><div className="mb-1 flex justify-between"><span>{d.label}</span><span className="tabular-nums text-[var(--text-2)]">{d.value}</span></div><div className="h-2 rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(d.value / total) * 100}%` }} /></div></li>))}</ul>)}
    </Card>
  );
}
