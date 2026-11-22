"use client";
import { useEffect } from "react";

/** iOS Safari ignores user-scalable=no, so block pinch and double-tap zoom explicitly. */
export function NoZoom() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const touch = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    let last = 0;
    const dbl = (e: TouchEvent) => { const now = Date.now(); if (now - last < 300) e.preventDefault(); last = now; };
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("touchmove", touch, { passive: false });
    document.addEventListener("touchend", dbl, { passive: false });
    return () => { document.removeEventListener("gesturestart", stop); document.removeEventListener("gesturechange", stop); document.removeEventListener("touchmove", touch); document.removeEventListener("touchend", dbl); };
  }, []);
  return null;
}
