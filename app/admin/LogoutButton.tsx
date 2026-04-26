"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="font-label text-[10px] tracking-[0.3em] uppercase text-gray-500 hover:text-primary transition-colors disabled:opacity-50"
    >
      Depart
    </button>
  );
}
