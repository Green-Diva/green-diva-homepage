"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type UserFormValues = {
  id?: string;
  name: string;
  gender: "" | "female" | "male" | "other";
  level: number;
  avatarUrl: string;
};

const empty: UserFormValues = {
  name: "",
  gender: "",
  level: 1,
  avatarUrl: "",
};

const input =
  "mt-2 w-full rounded-lg border border-primary/20 bg-surface-container px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none";

export function UserForm({
  mode,
  initial,
  initialMaskedToken,
}: {
  mode: "create" | "edit";
  initial?: Partial<UserFormValues>;
  initialMaskedToken?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<UserFormValues>({ ...empty, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [maskedToken, setMaskedToken] = useState<string | null>(initialMaskedToken ?? null);

  function field<K extends keyof UserFormValues>(key: K, v: UserFormValues[K]) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const body = {
      name: values.name,
      gender: values.gender || null,
      level: Number(values.level) || 1,
      avatarUrl: values.avatarUrl || null,
    };

    const url = mode === "create" ? "/api/users" : `/api/users/${values.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : JSON.stringify(j.error ?? r.statusText));
      return;
    }
    const data = await r.json();
    if (mode === "create") {
      setIssuedToken(data.token);
    } else {
      router.push("/admin/users");
      router.refresh();
    }
  }

  async function onRegenerate() {
    if (!values.id) return;
    if (!confirm("Rotate this user's token? Their current sessions will be revoked.")) return;
    const r = await fetch(`/api/users/${values.id}?regenerate=1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Rotate failed: ${j.error ?? r.statusText}`);
      return;
    }
    const data = await r.json();
    setIssuedToken(data.token);
    setMaskedToken(null);
  }

  if (issuedToken) {
    return (
      <main className="mx-auto w-full max-w-2xl px-8 py-14">
        <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
          Sacred Token Issued
        </span>
        <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
          Bear it carefully
        </h1>
        <p className="mt-4 text-sm text-on-surface-variant font-light">
          This token will only be revealed once. Copy it now and deliver it to {values.name}.
        </p>
        <div className="mt-6 rounded-lg border border-primary/30 bg-surface-container px-4 py-3 font-mono text-sm text-primary break-all">
          {issuedToken}
        </div>
        <div className="mt-6 flex gap-4">
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(issuedToken)}
            className="bg-primary/10 border border-primary/30 text-primary px-6 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              router.push("/admin/users");
              router.refresh();
            }}
            className="border border-primary/10 px-6 py-2 font-label tracking-widest uppercase text-[10px] text-gray-500 hover:text-primary hover:border-primary/30 transition-all rounded-lg"
          >
            Done
          </button>
        </div>
      </main>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl space-y-6 px-8 py-14">
      <div>
        <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
          {mode === "create" ? "New Acolyte" : "Amend Acolyte"}
        </span>
        <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
          {mode === "create" ? "Anoint" : "Refine"}
        </h1>
      </div>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Name</span>
        <input
          className={input}
          value={values.name}
          onChange={(e) => field("name", e.target.value)}
          required
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Gender</span>
          <select
            className={input}
            value={values.gender}
            onChange={(e) => field("gender", e.target.value as UserFormValues["gender"])}
          >
            <option value="">—</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">
            Level (≥100 = Priestess)
          </span>
          <input
            className={input}
            type="number"
            min={1}
            max={999}
            value={values.level}
            onChange={(e) => field("level", Number(e.target.value))}
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">
          Avatar URL (optional, will be system-generated later)
        </span>
        <input
          className={input}
          value={values.avatarUrl}
          onChange={(e) => field("avatarUrl", e.target.value)}
          placeholder="https://…"
        />
      </label>

      {mode === "edit" && maskedToken ? (
        <div className="border border-primary/10 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-label uppercase tracking-[0.3em] text-primary/60">Token</div>
            <div className="mt-2 font-mono text-sm text-on-surface-variant">{maskedToken}</div>
          </div>
          <button
            type="button"
            onClick={onRegenerate}
            className="border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/10 transition-all rounded-lg"
          >
            Regenerate
          </button>
        </div>
      ) : null}

      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      <div className="flex gap-4 pt-4">
        <button
          type="submit"
          disabled={busy}
          className="bg-primary/10 border border-primary/30 text-primary px-8 py-3 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg disabled:opacity-40"
        >
          {busy ? "…" : mode === "create" ? "Anoint" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/users")}
          className="border border-primary/10 px-8 py-3 font-label tracking-widest uppercase text-[10px] text-gray-500 hover:text-primary hover:border-primary/30 transition-all rounded-lg"
        >
          Withdraw
        </button>
      </div>
    </form>
  );
}
