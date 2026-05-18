"use client";

import { useT, useI18n } from "@/lib/i18n/client";

type Props = {
  side: "left" | "right";
  variant: "blank" | "create";
  isAdmin: boolean;
  onCreate?: () => void;
  onCornerNav?: () => void;
  cornerNavEnabled?: boolean;
  cornerNavLabel?: string;
};

// Used either as a trailing blank spread-mate when skill count is odd,
// or as the "inscribe new art" admin entry when paired with skills.
export default function SkillBookEmptyPage({
  side,
  variant,
  isAdmin,
  onCreate,
  onCornerNav,
  cornerNavEnabled,
  cornerNavLabel,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const sideClass = side === "left" ? "book-page--left" : "book-page--right";
  const corners =
    side === "left"
      ? ["book-corner--tl", "book-corner--bl"]
      : ["book-corner--tr", "book-corner--br"];

  return (
    <div className={`book-page ${sideClass}`}>
      {corners.map((c) => (
        <span key={c} className={`book-corner ${c}`} aria-hidden />
      ))}
      {onCornerNav && (
        <button
          type="button"
          onClick={onCornerNav}
          disabled={!cornerNavEnabled}
          aria-label={cornerNavLabel ?? (side === "left" ? "previous" : "next")}
          className={[
            "book-corner-nav",
            side === "left" ? "book-corner-nav--bl" : "book-corner-nav--br",
          ].join(" ")}
        >
          <span
            className={[
              "book-corner-nav-hint",
              locale === "zh" ? "book-corner-nav-hint--inline" : "book-corner-nav-hint--stacked",
            ].join(" ")}
          >
            {cornerNavLabel}
          </span>
        </button>
      )}
      <div className="book-page-content items-center justify-center text-center">
        {variant === "create" && isAdmin ? (
          <button
            type="button"
            onClick={onCreate}
            className="flex flex-col items-center gap-3 px-6 py-8 border border-secondary/40 rounded text-secondary/90 hover:text-secondary hover:border-secondary/70 hover:bg-secondary/5 transition-colors"
          >
            <span
              className="material-symbols-outlined text-[40px] text-secondary/85"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              auto_stories
            </span>
            <span className="font-label text-[12px] tracking-[0.3em] uppercase">
              {t.agentControl.skillBookCreateInline}
            </span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-50">
            <span
              className="material-symbols-outlined text-[40px] text-secondary/40"
              aria-hidden
            >
              menu_book
            </span>
            <span className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant/55">
              · · ·
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
