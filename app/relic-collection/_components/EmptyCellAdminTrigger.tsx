"use client";

import { useState, type ReactNode } from "react";
import RelicDraftPanel from "./RelicDraftPanel";

type Props = {
  slot: number;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
};

export default function EmptyCellAdminTrigger({ slot, ariaLabel, className, children }: Props) {
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
      {open ? <RelicDraftPanel slot={slot} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
