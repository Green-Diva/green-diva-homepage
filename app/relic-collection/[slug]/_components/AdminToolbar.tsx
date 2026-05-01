"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import RelicForm, { type RelicEditValue } from "@/app/admin/relics/RelicForm";
import MoveModal from "./MoveModal";
import ShareModal from "./ShareModal";
import ExtractModal from "./ExtractModal";

type Props = {
  relic: RelicEditValue & { slug: string };
  onChange?: () => void;
};

export default function AdminToolbar({ relic, onChange }: Props) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [extracting, setExtracting] = useState(false);

  return (
    <>
      <div className="border border-secondary/30 bg-secondary/5 p-3 flex flex-wrap items-center gap-2">
        <span className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mr-2">
          {t.adminRelics.adminToolbar}
        </span>
        <ToolbarBtn label={t.adminRelics.edit} onClick={() => setEditing(true)} />
        <ToolbarBtn label={t.adminRelics.move} onClick={() => setMoving(true)} />
        <ToolbarBtn label={t.adminRelics.share} onClick={() => setSharing(true)} />
        <ToolbarBtn
          label={t.adminRelics.extract}
          onClick={() => setExtracting(true)}
          danger
        />
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
      {sharing ? (
        <ShareModal
          relicId={relic.id}
          relicName={relic.nameEn}
          onClose={() => {
            setSharing(false);
            onChange?.();
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
            router.push("/relic-collection");
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
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 border font-label text-[11px] tracking-[0.2em] uppercase transition-all " +
        (danger
          ? "border-error/40 text-error hover:bg-error/10"
          : "border-primary/40 text-primary hover:bg-primary/10")
      }
    >
      {label}
    </button>
  );
}
