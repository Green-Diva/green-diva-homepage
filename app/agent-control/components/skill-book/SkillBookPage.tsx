"use client";

import { useT, useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, HandlerKind, EquipRow, AgentRow } from "../../types";
import { collectEquippedBy } from "@/lib/agentControl/equippedBy";

type Side = "left" | "right";

type ChapterInfo = {
  level: number;
  indexInLevel: number; // 1-based
  totalInLevel: number;
};

type Props = {
  skill: SkillRow;
  side: Side;
  pageNumber: number; // 1-based global page number
  chapter: ChapterInfo;
  equipsByAgentId: Record<string, EquipRow[]>;
  agents: AgentRow[];
  globallyEquipped: boolean;
  isAdmin: boolean;
  onTest: (s: SkillRow) => void;
  onEdit: (s: SkillRow) => void;
  /** Outside-bottom-corner click handler. left page → prev, right page → next. */
  onCornerNav?: () => void;
  cornerNavEnabled?: boolean;
  cornerNavLabel?: string;
};

const HANDLER_CHIP_LABEL: Record<HandlerKind, string> = {
  HTTP_API: "HTTP",
  LLM_PROMPT: "LLM",
  MCP_SERVER: "MCP",
};

export default function SkillBookPage({
  skill,
  side,
  pageNumber,
  chapter,
  equipsByAgentId,
  agents,
  globallyEquipped,
  isAdmin,
  onTest,
  onEdit,
  onCornerNav,
  cornerNavEnabled,
  cornerNavLabel,
}: Props) {
  const t = useT();
  const { locale } = useI18n();

  const name = locale === "zh" ? skill.nameZh : skill.nameEn;
  const altName = locale === "zh" ? skill.nameEn : skill.nameZh;
  const desc = locale === "zh" ? skill.descriptionZh : skill.descriptionEn;
  const altDesc = locale === "zh" ? skill.descriptionEn : skill.descriptionZh;
  const isOffline = skill.status === "OFFLINE";
  const equippedBy = collectEquippedBy(skill.id, equipsByAgentId, agents);

  const sideClass = side === "left" ? "book-page--left" : "book-page--right";
  const cornerSet =
    side === "left"
      ? ["book-corner--tl", "book-corner--bl"]
      : ["book-corner--tr", "book-corner--br"];

  return (
    <div className={`book-page ${sideClass}`}>
      {cornerSet.map((c) => (
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

      <div className="book-page-content">
        {/* — Chapter banner + handler sigil — */}
        <div className="flex items-start justify-between gap-3">
          <span className="book-chapter-banner">
            {format(t.agentControl.skillBookChapter, {
              lv: chapter.level,
              n: chapter.indexInLevel,
              total: chapter.totalInLevel,
            })}
          </span>
          <span
            className="font-label text-[10px] tracking-[0.2em] uppercase border border-secondary/45 text-secondary/85 rounded-sm px-2 py-1 font-mono bg-secondary/5"
            title="Handler type"
          >
            {HANDLER_CHIP_LABEL[skill.kind]}
          </span>
        </div>

        {/* — Sigil + title — */}
        <div className="flex items-center gap-3">
          <div
            className={[
              "shrink-0 w-14 h-14 rounded-full border flex items-center justify-center relative",
              isOffline
                ? "border-on-surface-variant/30 bg-surface-variant/30"
                : "border-primary/45 bg-primary/5 shadow-[0_0_20px_rgba(144,222,205,0.16)]",
            ].join(" ")}
          >
            <span
              className={[
                "material-symbols-outlined text-[30px]",
                isOffline ? "text-on-surface-variant/55" : "text-primary",
              ].join(" ")}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {skill.icon || "auto_awesome"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-[17px] leading-tight font-medium text-on-surface truncate">
              {name}
            </h2>
            {altName && (
              <p className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface-variant/70 truncate">
                {altName}
              </p>
            )}
            {skill.slug && (
              <p className="font-mono text-[9px] text-on-surface-variant/55 truncate">
                {skill.slug}
              </p>
            )}
          </div>
        </div>

        {/* — Status badges — */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={[
              "font-label text-[9px] tracking-[0.15em] uppercase border rounded-sm px-2 py-0.5 inline-flex items-center gap-1",
              isOffline
                ? "border-error/40 text-error/80"
                : "border-primary/40 text-primary/80",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "inline-block w-1.5 h-1.5 rounded-full",
                isOffline
                  ? "bg-error/70"
                  : "bg-primary/80 shadow-[0_0_4px_rgba(144,222,205,0.6)]",
              ].join(" ")}
            />
            {isOffline ? t.agentControl.skillStatusOffline : t.agentControl.skillStatusOnline}
          </span>
          {globallyEquipped && (
            <span className="font-label text-[9px] tracking-[0.12em] uppercase border border-primary/40 text-primary rounded-sm px-2 py-0.5">
              {t.agentControl.skillEquipped}
            </span>
          )}
        </div>

        {/* — Description (natural height, scrolls internally if too long) — */}
        {(desc || altDesc) && (
          <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-1 shrink">
            {desc && (
              <p className="text-[12px] leading-relaxed text-on-surface/90 whitespace-pre-wrap">
                {desc}
              </p>
            )}
            {altDesc && altDesc !== desc && (
              <p className="text-[10px] leading-relaxed text-on-surface-variant/65 italic whitespace-pre-wrap">
                {altDesc}
              </p>
            )}
          </div>
        )}

        {/* Top spacer — takes 2/3 of the remaining vertical room so the
            Equipped By band lands at roughly 2/3 down (= 1/3 above the
            admin action buttons). Keeps the band horizontally consistent
            across all pages regardless of description length. */}
        <div className="basis-0 flex-[2] min-h-0" aria-hidden />

        {/* — Equipped by — */}
        <div className="shrink-0">
          <h3 className="font-label text-[10px] tracking-[0.3em] text-secondary/80 uppercase mb-2">
            {t.agentControl.skillEquippedBy}
          </h3>
          {equippedBy.length === 0 ? (
            <p className="text-on-surface-variant/65 text-[11px]">
              {t.agentControl.skillEquippedByEmpty}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {equippedBy.map(({ agent, slotIndex }) => {
                const isMech = agent.mode === "MECHANICAL";
                const accentBorder = isMech ? "border-secondary/45" : "border-primary/45";
                const accentText = isMech ? "text-secondary" : "text-primary";
                const codename =
                  locale === "zh" && agent.codenameZh ? agent.codenameZh : agent.codename;
                const slotLabel =
                  slotIndex === null
                    ? t.agentControl.skillEquippedUnslotted
                    : format(t.agentControl.skillEquippedSlotLabel, { n: slotIndex + 1 });
                return (
                  <li
                    key={agent.id}
                    className={[
                      "flex items-center gap-2 border rounded-sm pl-1.5 pr-2.5 py-1 bg-surface-variant/30",
                      accentBorder,
                    ].join(" ")}
                    title={`${agent.codename} · ${slotLabel}`}
                  >
                    {agent.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={agent.avatarUrl}
                        alt=""
                        className="w-6 h-8 object-cover rounded-sm border border-on-surface-variant/20"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="w-6 h-8 rounded-sm border border-on-surface-variant/20 bg-surface-variant/40"
                      />
                    )}
                    <span className="flex flex-col leading-tight">
                      <span
                        className={[
                          "font-label text-[10px] tracking-[0.15em] uppercase",
                          accentText,
                        ].join(" ")}
                      >
                        {codename}
                      </span>
                      <span className="font-label text-[9px] tracking-[0.1em] uppercase text-on-surface-variant/60">
                        {slotLabel}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Bottom spacer — 1 part. Paired with the 2-part top spacer
            above the Equipped By band so the band lands at 2/3 down. */}
        <div className="basis-0 flex-[1] min-h-0" aria-hidden />

        {/* — Admin actions: bottom-right of body, above the page divider — */}
        {isAdmin && (
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => onTest(skill)}
              className="cyber-btn font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-3 flex items-center gap-1.5"
              title={t.agentControl.skillTestInvokeTitle}
            >
              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
              {t.agentControl.skillTestInvoke}
            </button>
            <button
              type="button"
              onClick={() => onEdit(skill)}
              className="font-label text-[10px] tracking-[0.2em] uppercase min-h-[36px] px-3 flex items-center gap-1.5 border border-secondary/40 text-secondary/85 hover:text-secondary hover:border-secondary/70 rounded transition-colors"
              title={t.agentControl.skillEdit}
            >
              <span className="material-symbols-outlined text-[14px]">edit</span>
              {t.agentControl.skillEdit}
            </button>
          </div>
        )}

        {/* — Footer: page number centered — */}
        <div className="flex items-end justify-center gap-3 pt-3 border-t border-secondary/15">
          <span
            className="font-label text-[11px] tracking-[0.3em] text-secondary/75 font-mono select-none"
            aria-hidden
          >
            — {pageNumber} —
          </span>
        </div>
      </div>
    </div>
  );
}
