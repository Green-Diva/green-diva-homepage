"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({ from }: { from?: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "The vault rejects your offering.");
      }
      const target = from && from.startsWith("/") ? from : "/";
      router.replace(target);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 flex w-full flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="XinHan's Token"
          autoFocus
          className="h-16 flex-1 rounded-lg border border-primary/20 bg-surface-container px-5 text-base text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !token}
          className="h-16 rounded-lg border border-primary/30 bg-primary/10 px-6 font-label text-[11px] tracking-[0.28em] uppercase text-primary transition-all hover:bg-primary/20 disabled:opacity-50 sm:min-w-[11rem]"
        >
          {pending ? "…" : "Enter Sanctuary"}
        </button>
      </div>
      {err ? <p className="text-sm leading-6 text-red-400">{err}</p> : null}
    </form>
  );
}
