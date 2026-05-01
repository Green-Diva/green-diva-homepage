"use client";

import { useState, type ReactNode } from "react";
import UnlockModal from "./UnlockModal";
import type { Dictionary } from "@/lib/i18n/types";

type Props = {
  relicId: string;
  reason: "needs-level" | "needs-password";
  required?: number;
  className?: string;
  ariaLabel: string;
  t: Dictionary;
  children: ReactNode;
};

export default function UnlockTrigger({
  relicId,
  reason,
  required,
  className,
  ariaLabel,
  t,
  children,
}: Props) {
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
        <UnlockModal
          relicId={relicId}
          reason={reason}
          required={required}
          t={t}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
