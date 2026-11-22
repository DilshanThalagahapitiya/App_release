"use client";
import * as React from "react";
import { ChevronLeft, Share, X } from "lucide-react";

const isStandalone = () => typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** App-style back button (the browser's own back button is not available in a Home Screen app). */
export function BackButton({ fallback, className = "" }: { fallback?: string; className?: string }) {
  const go = () => {
    if (history.length > 1) history.back();
    else if (fallback) location.href = fallback;
  };
  return (
    <button type="button" onClick={go} aria-label="Back" className={`flex h-9 items-center gap-0.5 rounded-full pr-2 text-[var(--accent)] active:opacity-60 ${className}`}>
      <ChevronLeft className="h-7 w-7" /><span className="text-[16px] font-medium">Back</span>
    </button>
  );
}

/** One-time hint on iPhone/iPad (outside the Home Screen app) explaining how to get the full-screen app. */
export function InstallHint() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    try {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && !isStandalone() && localStorage.getItem("a2hs-hint") !== "1") setShow(true);
    } catch { /* ignore */ }
  }, []);
  if (!show) return null;
  return (
    <div role="note" className="relative rounded-2xl bg-[var(--accent-soft)] px-4 py-3 pr-10 text-[14px] text-[var(--text)]">
      <p className="font-semibold">Use it like an app</p>
      <p className="mt-0.5 text-[var(--text-2)]">Open this page in <b>Safari</b>, tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> <b>Share</b>, then <b>Add to Home Screen</b>. It will open full-screen with no browser bars.</p>
      <button type="button" aria-label="Dismiss" onClick={() => { setShow(false); try { localStorage.setItem("a2hs-hint", "1"); } catch { /* ignore */ } }} className="absolute right-2 top-2 rounded-full p-1.5 text-[var(--text-3)]"><X className="h-4 w-4" /></button>
    </div>
  );
}
