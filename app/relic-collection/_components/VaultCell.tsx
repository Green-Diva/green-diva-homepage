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
  extractedAt?: string | null;
  extractedByName?: string | null;
}

type Props = {
  slot: number;
  relic: CellRelic | null;
  access: AccessResult | null;
  locale: Locale;
  t: Dictionary;
  isAdmin?: boolean;
  canViewExtracted?: boolean;
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

function rarityHoverClass(r: CellRelic["rarity"]): string {
  switch (r) {
    case "COMMON":
      return "hover:border-on-surface-variant/60 touch:border-on-surface-variant/60 hover:shadow-[inset_0_0_14px_rgba(212,220,217,0.18)]";
    case "RARE":
      return "hover:border-[#80c8ff] touch:border-[#80c8ff] hover:shadow-[inset_0_0_18px_rgba(128,200,255,0.28),0_0_14px_rgba(128,200,255,0.22)]";
    case "EPIC":
      return "hover:border-[#c79bff] touch:border-[#c79bff] hover:shadow-[inset_0_0_22px_rgba(199,155,255,0.32),0_0_18px_rgba(199,155,255,0.28)] hover:animate-cell-epic-pulse";
    case "LEGENDARY":
      return "hover:border-secondary touch:border-secondary hover:shadow-[inset_0_0_26px_rgba(255,219,60,0.36),0_0_22px_rgba(255,219,60,0.32)] hover:animate-cell-legendary-breath";
    case "SPECIAL":
      return "hover:border-[#ff9bcd] touch:border-[#ff9bcd] hover:shadow-[inset_0_0_30px_rgba(255,155,205,0.40),0_0_28px_rgba(255,155,205,0.45)] hover:animate-cell-special-ritual cell-special";
  }
}

function rarityFocusClass(r: CellRelic["rarity"]): string {
  switch (r) {
    case "COMMON":
      return "focus-visible:outline-on-surface-variant";
    case "RARE":
      return "focus-visible:outline-[#80c8ff]";
    case "EPIC":
      return "focus-visible:outline-[#c79bff]";
    case "LEGENDARY":
      return "focus-visible:outline-secondary";
    case "SPECIAL":
      return "focus-visible:outline-[#ff9bcd]";
  }
}

function raritySweepClass(r: CellRelic["rarity"]): string {
  switch (r) {
    case "COMMON":
      return "via-on-surface-variant";
    case "RARE":
      return "via-[#80c8ff]";
    case "EPIC":
      return "via-[#c79bff]";
    case "LEGENDARY":
      return "via-secondary";
    case "SPECIAL":
      return "via-[#ff9bcd]";
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
  isAdmin,
}: {
  relic: CellRelic;
  locale: Locale;
  access: AccessResult;
  t: Dictionary;
  isAdmin?: boolean;
}) {
  const name = locale === "zh" ? relic.nameZh : relic.nameEn;
  const classif = locale === "zh" ? relic.classifZh : relic.classifEn;
  const isExtracted = !!relic.extractedAt;
  const isLocked = !isExtracted && access.level === "RED";
  // Extracted cells render an "extinguished" LED — same shape as live ones but
  // no glow, dimmed colour. Living cells keep their access-tier indicator.
  const ledClass = isExtracted
    ? "w-2 h-2 bg-on-surface-variant/25 border border-on-surface-variant/30"
    : access.level === "RED"
      ? "w-2 h-2 bg-error shadow-[0_0_4px_currentColor,0_0_14px_currentColor] text-error"
      : access.level === "YELLOW"
        ? "w-2 h-2 bg-secondary shadow-[0_0_10px_currentColor] text-secondary"
        : "w-2 h-2 bg-primary shadow-[0_0_12px_currentColor] text-primary";
  const accentClass = isExtracted ? "text-on-surface-variant" : rarityAccent(relic.rarity);

  return (
    <>
      <CellOrnaments />
      {isLocked ? (
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden>
          <span className="relative w-[72%] h-[72%] text-error">
            <span className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 rotate-45 bg-gradient-to-r from-transparent via-error/80 to-transparent shadow-[0_0_10px_rgba(255,77,77,0.55)]" />
            <span className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 -rotate-45 bg-gradient-to-r from-transparent via-error/80 to-transparent shadow-[0_0_10px_rgba(255,77,77,0.55)]" />
          </span>
        </span>
      ) : null}
      <span className={"absolute top-1.5 right-1.5 z-20 rounded-full " + ledClass} />
      <span className="absolute top-1.5 left-2 font-label text-[10px] tracking-[0.2em] text-on-surface-variant/75">
        {String(relic.slot).padStart(3, "0")}
      </span>
      {/* Four fixed-percentage tiers (icon / name / classif / badge) keep
          live + extracted cells perfectly aligned, and the hover sweep
          (also at 85%) lands on the same baseline as the EXTRACTED badge. */}
      <span
        className={"absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 material-symbols-outlined " + accentClass}
        style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
      >
        {relic.iconKey || "inventory_2"}
      </span>
      <span
        className={"absolute left-2 right-2 top-[55%] -translate-y-1/2 block font-label text-[10px] tracking-[0.2em] uppercase line-clamp-1 leading-[1.35] text-center " + accentClass}
      >
        {name}
      </span>
      <span
        className={"absolute left-2 right-2 top-[70%] -translate-y-1/2 block font-label text-[9px] tracking-[0.2em] uppercase opacity-75 line-clamp-1 text-center " + accentClass}
      >
        {classif}
      </span>
      {isExtracted ? (
        <span className="absolute left-1/2 top-[85%] -translate-x-1/2 -translate-y-1/2 z-20 px-2 py-0.5 font-label text-[8px] tracking-[0.25em] uppercase border border-on-surface-variant/65 text-on-surface-variant bg-surface-container leading-none whitespace-nowrap">
          {t.relicCollection.extractedTag}
        </span>
      ) : null}
    </>
  );
}

export default function VaultCell({ slot, relic, access, locale, t, isAdmin, canViewExtracted }: Props) {
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

  // Extracted: lights-off memorial shell. Visible to everyone, but only
  // admin / extractor / grant-holders can click in. Others get a static,
  // non-interactive shell (cursor-not-allowed, no hover transitions).
  if (relic.extractedAt) {
    const greyBase =
      baseClasses +
      " border border-on-surface-variant/25 bg-surface-container/60 shadow-[inset_0_0_22px_rgba(0,0,0,0.45)] opacity-50";
    if (canViewExtracted) {
      return (
        <Link
          href={`/relic-collection/${relic.slug}`}
          aria-label={t.relicCollection.extractedTag + " · " + (locale === "zh" ? relic.nameZh : relic.nameEn)}
          className={greyBase + " hover:opacity-90 focus-visible:opacity-90 cursor-pointer hover:bg-surface-container/80 hover:shadow-[inset_0_0_42px_rgba(0,0,0,0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-on-surface-variant focus-visible:outline-offset-1"}
        >
          <CellInner relic={relic} locale={locale} access={access ?? { level: "GREEN", reason: "admin" }} t={t} isAdmin={isAdmin} />
        </Link>
      );
    }
    return (
      <div
        className={greyBase + " cursor-not-allowed select-none"}
        aria-label={t.relicCollection.extractedTag + " · " + (locale === "zh" ? relic.nameZh : relic.nameEn)}
        aria-disabled
      >
        <CellInner relic={relic} locale={locale} access={access ?? { level: "GREEN", reason: "admin" }} t={t} isAdmin={isAdmin} />
      </div>
    );
  }

  if (!access || access.level === "RED") {
    const reason = access?.reason === "locked-password" ? "locked-password" : "locked-level";
    const required = access && access.reason === "locked-level" ? access.required : undefined;
    return (
      <UnlockTrigger
        relicId={relic.id}
        reason={reason}
        required={required}
        ariaLabel={t.relicCollection.accessRed}
        t={t}
        className={
          baseClasses +
          " border border-error/30 hover:border-error/60 touch:border-error/60 hover:shadow-[inset_0_0_18px_rgba(255,77,77,0.22)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-error focus-visible:outline-offset-1"
        }
      >
        <CellInner
          relic={relic}
          locale={locale}
          access={access ?? { level: "RED", reason }}
          t={t}
          isAdmin={isAdmin}
        />
      </UnlockTrigger>
    );
  }

  const isSpecial = relic.rarity === "SPECIAL";
  return (
    <Link
      href={`/relic-collection/${relic.slug}`}
      aria-label={t.relicCollection.accessGreen + " · " + (locale === "zh" ? relic.nameZh : relic.nameEn)}
      className={
        baseClasses +
        " border border-primary/40 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 " +
        rarityHoverClass(relic.rarity) +
        " " +
        rarityFocusClass(relic.rarity)
      }
    >
      <CellInner relic={relic} locale={locale} access={access} t={t} isAdmin={isAdmin} />
      <span
        className={
          "pointer-events-none absolute left-[18%] right-[18%] top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 group-hover:opacity-100 group-hover:top-[85%] transition-all duration-700 ease-out " +
          raritySweepClass(relic.rarity)
        }
      />
      {isSpecial ? (
        <>
          <span className="cell-ritual-ring" aria-hidden />
          <span className="cell-ritual-runes" aria-hidden />
        </>
      ) : null}
    </Link>
  );
}
