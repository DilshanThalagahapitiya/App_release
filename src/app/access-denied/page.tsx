import { ShieldAlert } from "lucide-react";
export const metadata = { title: "Access denied" };
export default function Denied() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <ShieldAlert className="h-10 w-10 text-[var(--bad)]" aria-hidden />
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="max-w-sm text-[var(--text-2)]">Your account doesn&apos;t have permission to view that page. If you think this is a mistake, ask an administrator of your organisation.</p>
      <a href="/">Back to my portal</a>
    </div>
  );
}
