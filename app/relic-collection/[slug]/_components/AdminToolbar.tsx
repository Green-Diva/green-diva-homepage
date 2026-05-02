"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import RelicForm, { type RelicEditValue } from "@/app/admin/relics/RelicForm";
import type { AccessReason } from "@/lib/relicAccess";
import MoveModal from "./MoveModal";
import ShareModal from "./ShareModal";
import GrantModal from "./GrantModal";
import ExtractModal from "./ExtractModal";

type Props = {
  relic: RelicEditValue & { slug: string };
  accessReason: AccessReason;
  isExtracted: boolean;
  onChange?: () => void;
  rightSlot?: React.ReactNode;
};

export default function AdminToolbar({ relic, accessReason, isExtracted, onChange, rightSlot }: Props) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // Once extracted, the relic is permanently out of circulation. Nobody —
  // including admin — can edit, move, grant, share, or re-extract. The detail
  // page becomes a read-only memorial.
  if (isExtracted) return null;

  const isAdmin = accessReason === "admin";
  const canExtract = accessReason === "admin" || accessReason === "granted";

  return (
    <>
      <div className="border border-secondary/30 bg-secondary/5 p-3 flex flex-wrap items-center gap-2">
        <span className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mr-2">
          {t.adminRelics.adminToolbar}
        </span>
        <ToolbarBtn label={t.adminRelics.edit} onClick={() => setEditing(true)} disabled={!isAdmin} />
        <ToolbarBtn label={t.adminRelics.move} onClick={() => setMoving(true)} disabled={!isAdmin} />
        <ToolbarBtn label={t.adminRelics.grant} onClick={() => setGranting(true)} disabled={!isAdmin} />
        <ToolbarBtn label={t.adminRelics.share} onClick={() => setSharing(true)} disabled={!isAdmin} />
        <ToolbarBtn label={t.adminRelics.extract} onClick={() => setExtracting(true)} disabled={!canExtract} />
        {rightSlot ? <div className="ml-auto flex flex-wrap items-center gap-2">{rightSlot}</div> : null}
      </div>

      {editing ? (
        <RelicForm
          initial={relic}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange?.();
            router.refresh();
          }}
        />
      ) : null}
      {moving ? (
        <MoveModal
          relicId={relic.id}
          currentSlot={relic.slot}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            onChange?.();
            router.refresh();
          }}
        />
      ) : null}
      {granting ? (
        <GrantModal
          relicId={relic.id}
          relicName={relic.nameEn}
          onClose={() => setGranting(false)}
          onFinish={() => {
            setGranting(false);
            onChange?.();
            router.refresh();
          }}
        />
      ) : null}
      {sharing ? (
        <ShareModal
          relicId={relic.id}
          relicName={relic.nameEn}
          onClose={() => setSharing(false)}
          onFinish={() => {
            setSharing(false);
            onChange?.();
            router.refresh();
          }}
        />
      ) : null}
      {extracting ? (
        <ExtractModal
          relicId={relic.id}
          relicName={relic.nameEn}
          onClose={() => setExtracting(false)}
          onExtracted={() => {
            setExtracting(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ToolbarBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1.5 border font-label text-[11px] tracking-[0.2em] uppercase transition-all border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      }
    >
      {label}
    </button>
  );
}
