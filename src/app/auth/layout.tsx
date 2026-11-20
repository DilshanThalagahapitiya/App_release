import { Box } from "lucide-react";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2"><Box className="h-6 w-6 text-[var(--accent)]" /><span className="text-lg font-semibold">Release Portal</span></div>
      <div className="card w-full max-w-sm p-6">{children}</div>
    </div>
  );
}
