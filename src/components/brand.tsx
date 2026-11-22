import { PackageCheck } from "lucide-react";

/** Crede Technologies wordmark for the App Release Portal. */
export function Brand({ size = "md", subtitle = true }: { size?: "md" | "lg"; subtitle?: boolean }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white ${big ? "h-11 w-11" : "h-9 w-9"}`}><PackageCheck className={big ? "h-6 w-6" : "h-5 w-5"} aria-hidden /></span>
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight text-[var(--brand-navy)] ${big ? "text-2xl" : "text-lg"}`}>Crede<span className="font-medium"> Technologies</span></span>
        {subtitle && <span className={`block font-medium text-[var(--text-3)] ${big ? "text-[13px]" : "text-[11px]"}`}>App Release Portal</span>}
      </span>
    </div>
  );
}
