"use client";
import * as React from "react";
import { Maximize2, RefreshCw } from "lucide-react";

/** Embeds the Appetize simulator with loading, error and full-screen handling. */
export function PreviewEmbed({ src, appName }: { src: string; appName: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [nonce, setNonce] = React.useState(0);
  const box = React.useRef<HTMLDivElement>(null);
  const [canFull, setCanFull] = React.useState(false);
  React.useEffect(() => { setCanFull(!!document.fullscreenEnabled); }, []);
  React.useEffect(() => {
    setState("loading");
    const t = setTimeout(() => setState((s) => (s === "loading" ? "error" : s)), 30000);
    return () => clearTimeout(t);
  }, [nonce, src]);
  return (
    <div className="space-y-3">
      <div ref={box} className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[#0e1116]">
        {state === "loading" && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0e1116] text-[15px] text-white/80" role="status"><span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Loading the simulator…</div>}
        {state === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0e1116] px-6 text-center text-white" role="alert">
            <p className="text-[17px] font-semibold">The simulator did not load</p>
            <p className="text-[14px] text-white/70">Check your internet connection and try again. If it keeps failing, ask the team to check the preview.</p>
            <button type="button" onClick={() => setNonce((n) => n + 1)} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 font-semibold text-black"><RefreshCw className="h-4 w-4" />Try again</button>
          </div>)}
        <iframe key={nonce} src={src} title={`${appName} interactive preview`} allow="fullscreen; autoplay" className="block h-[min(80vh,860px)] min-h-[520px] w-full" style={{ border: 0 }} onLoad={() => setState("ready")} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-[var(--text-2)]">Tap the screen to start. This is a real iOS app running in the cloud, so it can take a few seconds to begin.</p>
        {canFull && <button type="button" onClick={() => { void box.current?.requestFullscreen?.(); }} className="flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] px-3 py-2 text-[14px] font-medium"><Maximize2 className="h-4 w-4" />Full screen</button>}
      </div>
    </div>
  );
}
