"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type NavItem = { label: string; href: string; active?: boolean };

export default function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center rounded-md border border-primary/20 text-primary hover:border-primary/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
      >
        <span className="material-symbols-outlined text-xl">menu</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex flex-col bg-background"
            >
          <div className="flex justify-end p-5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="w-11 h-11 flex items-center justify-center rounded-md border border-primary/20 text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <nav className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
            {items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={item.active ? "page" : undefined}
                className={`font-label text-base tracking-[0.4em] uppercase pb-1 border-b min-h-[44px] flex items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4 ${
                  item.active
                    ? "text-primary border-secondary/40"
                    : "text-on-surface-variant border-transparent"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
