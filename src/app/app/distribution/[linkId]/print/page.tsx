"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { useApi, type LinkDto } from "@/components/features";
import { QRCodePanel } from "@/components/features";

export default function PrintQr() {
  const { linkId } = useParams<{ linkId: string }>();
  const q = useApi<LinkDto & { build: { version: string | null; build_number: string | null } }>(["link", linkId], `/distribution-links/${linkId}`);
  return (
    <div className="mx-auto max-w-md space-y-4 p-8 text-center print:p-0">
      <h1 className="text-xl font-semibold">{q.data?.title ?? "…"}</h1>
      {q.data && q.data.state === "active" ? <QRCodePanel linkId={linkId} url={q.data.url ?? ""} /> : q.data ? <p>This link is {q.data.state}.</p> : null}
      {q.data?.url && <p className="break-all text-xs">{q.data.url}</p>}
      {q.data?.expires_at && <p className="text-xs">Valid until {new Date(q.data.expires_at).toLocaleString()}</p>}
      <p className="text-xs muted">Scanning opens a protected page. Installation still depends on Apple signing and device registration.</p>
      <button className="rounded-lg border px-3 py-1.5 print:hidden" onClick={() => window.print()}>Print</button>
    </div>
  );
}
