import Link from "next/link";
import type { Locale } from "@/lib/i18n/types";
import type { Dictionary } from "@/lib/i18n/types";
import { format } from "@/lib/i18n/format";
import type { AccessResult } from "@/lib/relicAccess";
import UnlockTrigger from "./UnlockTrigger";
import EmptyCellAdminTrigger from "./EmptyCellAdminTrigger";

export interface CellRelic {
  id: string;
  slot: number;
  slug: string;
  nameEn: string;
  nameZh: string;
  classifEn: string;
  classifZh: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";
  iconKey: string | null;
}

type Props = {
  slot: number;
  relic: CellRelic | null;
  access: AccessResult | null;
  locale: Locale;
  t: Dictionary;
  isAdmin?: boolean;
};

function rarityAccent(r: CellRelic["rarity"]): string {
  switch (r) {
    case "COMMON":
      return "text-on-surface-variant";
    case "RARE":
      return "text-[#80c8ff]";
    case "EPIC":
      return "text-[#c79bff]";
    case "LEGENDARY":
      return "text-secondary";
    case "SPECIAL":
      return "text-[#ff9bcd]";
  }
}

function CellOrnaments() {
  return (
    <>
      <span className="absolute top-0 left-0 w-1.5 h-1.5 border-l border-t border-primary/60" />
      <span className="absolute top-0 right-0 w-1.5 h-1.5 border-r border-t border-primary/60" />
      <span className="absolute bottom-0 left-0 w-1.5 h-1.5 border-l border-b border-primary/60" />
      <span className="absolute bottom-0 right-0 w-1.5 h-1.5 border-r border-b border-primary/60" />
    </>
  );
}

function CellInner({
  relic,
  locale,
  access,
  t,
}: {
  relic: CellRelic;
  locale: Locale;
  access: AccessResult;
  t: Dictionary;
}) {
  const name = locale === "zh" ? relic.nameZh : relic.nameEn;
  const classif = locale === "zh" ? relic.classifZh : relic.classifEn;
  const isSpecialUnlocked = access.ok && access.reason === "unlocked";
  const isShared = access.ok && access.reason === "shared";
  const ledClass = !access.ok
    ? "bg-error shadow-[0_0_8px_currentColor] text-error"
    : isSpecialUnlocked
      ? "bg-secondary shadow-[0_0_10px_currentColor] text-secondary animate-pulse"
      : isShared
        ? "bg-[#ff9bcd] shadow-[0_0_10px_currentColor] text-[#ff9bcd] animate-pulse"
        : "bg-primary shadow-[0_0_10px_currentColor] text-primary";

  return (
    <>
      <CellOrnaments />
      <span className={"absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full " + ledClass} />
      {isShared ? (
        <span className="absolute bottom-1.5 right-1.5 px-1 py-0.5 font-label text-[7px] tracking-[0.2em] uppercase border border-[#ff9bcd]/60 text-[#ff9bcd] bg-[#ff9bcd]/5 leading-none">
          {t.relicCollection.shared}
        </span>
      ) : null}
      <span className="absolute top-1.5 left-2 font-label text-[10px] tracking-[0.2em] text-on-surface-variant/75">
        {String(relic.slot).padStart(3, "0")}
      </span>
      <div className={"flex flex-col items-center justify-center gap-2 px-2 text-center " + rarityAccent(relic.rarity)}>
        {relic.iconKey ? (
          relic.iconKey.length === 1 ? (
            <span className="font-headline text-2xl tracking-wider">{relic.iconKey}</span>
          ) : (
            <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}>
              {relic.iconKey}
            </span>
          )
        ) : (
          <span className="material-symbols-outlined text-[28px]">inventory_2</span>
        )}
        <span className="block font-label text-[10px] tracking-[0.2em] uppercase line-clamp-2 leading-[1.35]">
          {name}
        </span>
        <span className="block font-label text-[9px] tracking-[0.2em] uppercase opacity-75 line-clamp-1">
          {classif}
        </span>
      </div>
    </>
  );
}

export default function VaultCell({ slot, relic, access, locale, t, isAdmin }: Props) {
  const baseClasses =
    "relative bg-background/80 aspect-square min-h-[88px] lg:aspect-auto lg:min-h-0 flex items-center justify-center transition-all duration-300 group overflow-hidden";

  if (!relic) {
    if (isAdmin) {
      return (
        <EmptyCellAdminTrigger
          slot={slot}
          ariaLabel={t.relicCollection.adminInscribeHere}
          t={t}
          className={
            baseClasses +
            " border border-secondary/30 hover:border-secondary/70 touch:border-secondary/70 hover:shadow-[inset_0_0_18px_rgba(255,219,60,0.16)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
          }
        >
          <CellOrnaments />
          <span className="absolute top-1.5 left-2 font-label text-[10px] tracking-[0.2em] text-on-surface-variant/55">
            {String(slot).padStart(3, "0")}
          </span>
          <span className="material-symbols-outlined text-secondary/55 group-hover:text-secondary touch:text-secondary text-[28px] transition-colors">add</span>
          <span className="sr-only">{t.relicCollection.adminInscribeHere}</span>
        </EmptyCellAdminTrigger>
      );
    }
    return (
      <div
        className={baseClasses + " border border-primary/10 cursor-not-allowed select-none"}
        aria-label={format(t.relicCollection.cellSlot, { slot })}
      >
        <CellOrnaments />
        <span className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant/45 leading-tight text-center px-2">
          {t.relicCollection.cellEmpty}
          <br />
          <span className="opacity-60">{format(t.relicCollection.cellSlot, { slot })}</span>
        </span>
      </div>
    );
  }

  if (!access || !access.ok) {
    const reason = access?.ok === false ? access.reason : "needs-level";
    const required = access && !access.ok && access.reason === "needs-level" ? access.required : undefined;
    return (
      <UnlockTrigger
        relicId={relic.id}
        reason={reason}
        required={required}
        ariaLabel={t.relicCollection.accessRed}
        t={t}
        className={
          baseClasses +
          " border border-error/30 hover:border-error/60 touch:border-error/60 hover:shadow-[inset_0_0_18px_rgba(255,180,171,0.18)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-error focus-visible:outline-offset-1"
        }
      >
        <CellInner relic={relic} locale={locale} access={{ ok: false, reason } as AccessResult} t={t} />
      </UnlockTrigger>
    );
  }

  return (
    <Link
      href={`/relic-collection/${relic.slug}`}
      aria-label={t.relicCollection.accessGreen + " · " + (locale === "zh" ? relic.nameZh : relic.nameEn)}
      className={
        baseClasses +
        " border border-primary/40 hover:border-primary touch:border-primary hover:shadow-[inset_0_0_22px_rgba(82,253,207,0.28)] touch:shadow-[inset_0_0_18px_rgba(82,253,207,0.22)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1"
      }
    >
      <CellInner relic={relic} locale={locale} access={access} t={t} />
      <span className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-0 group-hover:opacity-100 group-hover:translate-y-[88px] transition-all duration-700" />
    </Link>
  );
}
