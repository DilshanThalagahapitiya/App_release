"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiFetch } from "@/lib/client";
import { Button, Callout, FormField, Input } from "@/components/ui";
import { useSearchParams } from "next/navigation";

const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
type V = z.infer<typeof schema>;

function Form() {
  const params = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });
  const [error, setError] = useState("");
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
      <h1 className="text-lg font-semibold">Sign in</h1>
      {params.get("expired") && <Callout tone="warn" title="Session expired">Please sign in again to continue.</Callout>}
      {error && <Callout tone="bad">{error}</Callout>}
      <FormField label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="username" {...register("email")} /></FormField>
      <FormField label="Password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete="current-password" {...register("password")} /></FormField>
      {site && <div id="ts" />}
      <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>Sign in</Button>
      <p className="text-center text-[13px]"><a href="/auth/forgot-password">Forgot password?</a></p>
    </form>
  );
}
export default function LoginPage() { return <Suspense><Form /></Suspense>; }
