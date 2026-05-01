"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import RelicForm from "@/app/admin/relics/RelicForm";
import type { Dictionary } from "@/lib/i18n/types";

type Props = {
  slot: number;
  ariaLabel: string;
  className?: string;
  t: Dictionary;
  children: ReactNode;
};

export default function EmptyCellAdminTrigger({ slot, ariaLabel, className, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </button>
      {open ? (
        <RelicForm
          initial={null}
          presetSlot={slot}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
