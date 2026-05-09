"use client";

import { useState, type ReactNode } from "react";
import RelicDraftPanel from "./RelicDraftPanel";

type Props = {
  slot: number;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
  // When set, opens the modal directly into stage 2/3 (waiting / preview /
  // failed) of an in-progress draft instead of starting a new upload. Used
  // by draft cells in the vault grid.
  existingDraftId?: string;
};

export default function EmptyCellAdminTrigger({
  slot,
  ariaLabel,
  className,
  children,
  existingDraftId,
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
        <RelicDraftPanel
          slot={slot}
          existingDraftId={existingDraftId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
