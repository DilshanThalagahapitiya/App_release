import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <a href="/auth/login" style={{ textDecoration: "none" }}><Brand size="lg" /></a>
        <a href="/auth/login" className="rounded-lg border-2 border-[var(--accent)] bg-[var(--surface)] px-5 py-2 text-[15px] font-semibold" style={{ textDecoration: "none" }}>Login</a>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[0_10px_40px_rgba(40,80,150,.10)] sm:p-9">{children}</div>
      </main>
    </div>
  );
}
