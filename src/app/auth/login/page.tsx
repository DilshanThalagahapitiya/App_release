"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiFetch } from "@/lib/client";
import { Button, Callout } from "@/components/ui";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";

const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
type V = z.infer<typeof schema>;

function Form() {
  const params = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [site, setSite] = useState<string | null>(null);
  const tokenRef = useRef<string>("");
  useEffect(() => { fetch("/api/v1/auth/turnstile").then((r) => r.json() as Promise<{ data?: { siteKey?: string | null } }>).then((j) => setSite(j.data?.siteKey ?? null)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!site) return;
    const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
    s.onload = () => (window as unknown as { turnstile: { render: (el: string, o: object) => void } }).turnstile.render("#ts", { sitekey: site, callback: (t: string) => { tokenRef.current = t; } });
    document.head.appendChild(s);
  }, [site]);
  return (
    <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
      setError("");
      try { const me = await apiFetch<{ portal: string }>("/auth/login", { body: { ...v, turnstileToken: tokenRef.current || undefined } }); const next = params.get("next"); location.href = next && /^\/d\/[A-Za-z0-9_-]+$/.test(next) ? next : me.portal === "admin" ? "/app" : "/portal"; }
      catch (e) { setError((e as Error).message); }
    })}>
      <div><h1 className="text-xl font-semibold">Log in to Your Account</h1><p className="mt-1 text-[13px] text-[var(--text-3)]">Crede App Release Portal</p><p className="mt-3 text-[14px] text-[var(--text-2)]">Welcome back. Sign in to download test builds, install apps and share feedback.</p></div>
      <hr className="border-[var(--border)]" />
      {params.get("expired") && <Callout tone="warn" title="Session expired">Please sign in again to continue.</Callout>}
      {error && <Callout tone="bad">{error}</Callout>}
      <div>
        <div className="flex h-11 overflow-hidden rounded-md border border-[var(--border-strong)] focus-within:border-[var(--accent)]">
          <span className="flex w-11 items-center justify-center border-r border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-2)]"><Mail className="h-4 w-4" aria-hidden /></span>
          <input id="email" type="email" aria-label="Email" placeholder="Email" autoComplete="username" className="min-w-0 flex-1 bg-[var(--surface)] px-3 text-[15px] outline-none" {...register("email")} />
        </div>
        {errors.email && <p role="alert" className="mt-1 text-xs text-[var(--bad)]">{errors.email.message}</p>}
      </div>
      <div>
        <div className="flex h-11 overflow-hidden rounded-md border border-[var(--border-strong)] focus-within:border-[var(--accent)]">
          <span className="flex w-11 items-center justify-center border-r border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-2)]"><LockKeyhole className="h-4 w-4" aria-hidden /></span>
          <input id="password" type={show ? "text" : "password"} aria-label="Password" placeholder="Password" autoComplete="current-password" className="min-w-0 flex-1 bg-[var(--surface)] px-3 text-[15px] outline-none" {...register("password")} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="px-3 text-[var(--text-2)]">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
        {errors.password && <p role="alert" className="mt-1 text-xs text-[var(--bad)]">{errors.password.message}</p>}
      </div>
      {site && <div id="ts" />}
      <Button type="submit" variant="secondary" loading={isSubmitting} className="!h-11 w-full !border-2 !border-[var(--accent)] !text-[16px] !font-semibold !text-[var(--accent)]">Login</Button>
      <p className="text-center text-[14px]"><a href="/auth/forgot-password">Forgot Password</a></p>
      <hr className="border-[var(--border)]" />
      <p className="text-center text-[13px] text-[var(--text-2)]">New here? Access is by invitation only. Please contact your Crede Technologies administrator to be invited.</p>
      <p className="text-center text-xs text-[var(--text-3)]">Secure, private distribution of iOS test builds.</p>
    </form>
  );
}
export default function LoginPage() { return <Suspense><Form /></Suspense>; }
