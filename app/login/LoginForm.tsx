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
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          autoFocus
          className="flex-1 bg-surface-container border border-primary/20 px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none rounded-lg"
        />
        <button
          type="submit"
          disabled={pending || !token}
          className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg disabled:opacity-50"
        >
          {pending ? "…" : "Enter"}
        </button>
      </div>
      {err ? <p className="text-xs text-red-400 font-light">{err}</p> : null}
    </form>
  );
}
