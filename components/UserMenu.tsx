"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

type Props = {
  user: {
    name: string;
    level: number;
    avatarUrl: string | null;
    gender: string | null;
  };
  isAdmin: boolean;
};

export default function UserMenu({ user, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const t = useT();
  const initial = user.name.trim().charAt(0).toUpperCase() || "·";
  const tier =
    user.level >= 100
      ? t.tier.highLord
      : format(t.tier.acolyte, { level: user.level });

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.userMenu.aria}
        className="flex items-center gap-3 group cursor-pointer"
      >
        <div className="hidden sm:flex flex-col items-center leading-tight">
          <span className="font-headline text-[13px] text-primary tracking-tight">
            {user.name}
          </span>
          <span className="font-label text-[9px] text-secondary/80 tracking-[0.3em] uppercase -mr-[0.3em]">
            {tier}
          </span>
        </div>
        <div className="w-10 h-10 rounded-full border border-primary/30 overflow-hidden hover:border-primary/60 transition-colors flex items-center justify-center bg-surface-container text-primary font-headline text-base">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={user.name}
              src={user.avatarUrl}
              className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-[filter] duration-500"
            />
          ) : (
            <span className="select-none">{initial}</span>
          )}
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-3 w-56 rounded-xl border border-primary/20 bg-surface-container/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden z-50"
        >
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 border-b border-primary/10 hover:bg-primary/10 transition-colors"
          >
            <div className="font-headline text-sm text-primary truncate">{user.name}</div>
            <div className="font-label text-[9px] text-secondary tracking-[0.3em] uppercase mt-1">
              {tier}
            </div>
          </Link>
          {isAdmin ? (
            <Link
              href="/admin/users"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-3 font-label text-[10px] tracking-[0.3em] uppercase text-primary/80 hover:text-primary hover:bg-primary/10 transition-colors"
            >
              {t.userMenu.memberReview}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="block w-full text-left px-4 py-3 font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            {t.userMenu.logOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
