"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import type { SkillRow, EquipRow, AgentRow } from "../../types";
import SkillBookPage from "./SkillBookPage";
import SkillBookEmptyPage from "./SkillBookEmptyPage";
import type { SkillBookEntry } from "@/lib/agentControl/skillBookEntries";

type FlipState =
  | { phase: "idle" }
  | { phase: "flipping"; direction: "next" | "prev"; from: number; to: number; armed: boolean };

type Props = {
  entries: SkillBookEntry[];
  equipsByAgentId: Record<string, EquipRow[]>;
  agents: AgentRow[];
  isAdmin: boolean;
  /** Index in `entries` of the left page. Right page = entries[leftPageIndex+1] or blank. */
  leftPageIndex: number;
  onChangeLeftIndex: (next: number) => void;
  onTest: (s: SkillRow) => void;
  onEdit: (s: SkillRow) => void;
  onCreate: () => void;
};

const BLANK_ENTRY: SkillBookEntry = { kind: "blank" };

// Controlled left-page index. Chevron / keyboard ±2 = one "page turn" with
// 3D flip; external jumps (TOC click) of any size skip the animation.
export default function SkillBook({
  entries,
  equipsByAgentId,
  agents,
  isAdmin,
  leftPageIndex,
  onChangeLeftIndex,
  onTest,
  onEdit,
  onCreate,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState<FlipState>({ phase: "idle" });

  const totalEntries = entries.length;
  const lastLeftIndex = Math.max(0, totalEntries - 1);
  const safeLeftIndex = Math.min(Math.max(0, leftPageIndex), lastLeftIndex);

  const pairAt = useCallback(
    (left: number): [SkillBookEntry, SkillBookEntry] => {
      const l = entries[left] ?? BLANK_ENTRY;
      const r = entries[left + 1] ?? BLANK_ENTRY;
      return [l, r];
    },
    [entries],
  );

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const startFlip = useCallback(
    (direction: "next" | "prev") => {
      if (flip.phase !== "idle") return;
      const from = safeLeftIndex;
      const to = direction === "next" ? from + 2 : from - 2;
      if (to < 0 || to > lastLeftIndex) return;
      if (prefersReducedMotion) {
        onChangeLeftIndex(to);
        return;
      }
      setFlip({ phase: "flipping", direction, from, to, armed: false });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlip((prev) =>
            prev.phase === "flipping" && prev.from === from && prev.to === to
              ? { ...prev, armed: true }
              : prev,
          );
        });
      });
    },
    [flip.phase, safeLeftIndex, lastLeftIndex, prefersReducedMotion, onChangeLeftIndex],
  );

  const onFlipEnd = useCallback(() => {
    setFlip((prev) => {
      if (prev.phase !== "flipping") return prev;
      onChangeLeftIndex(prev.to);
      return { phase: "idle" };
    });
  }, [onChangeLeftIndex]);

  // Keyboard: ← / → flip; Home / End jump.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        startFlip("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        startFlip("next");
      } else if (e.key === "Home") {
        e.preventDefault();
        onChangeLeftIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        onChangeLeftIndex(lastLeftIndex);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [startFlip, lastLeftIndex, onChangeLeftIndex]);

  // Only the BASE (top) layer gets corner-nav hooks. Pages drawn for
  // the flipper / destination layer are inert; passing the handler there
  // would let users click during animation and double-fire.
  const renderEntry = useCallback(
    (
      entry: SkillBookEntry,
      side: "left" | "right",
      pageNumber: number,
      opts?: { interactive?: boolean },
    ) => {
      const interactive = opts?.interactive ?? false;
      const cornerNavProps = interactive
        ? side === "left"
          ? {
              onCornerNav: () => startFlip("prev"),
              cornerNavEnabled: safeLeftIndex > 0 && flip.phase === "idle",
              cornerNavLabel:
                safeLeftIndex > 0
                  ? t.agentControl.skillBookPrev
                  : t.agentControl.skillBookFirstPage,
            }
          : {
              onCornerNav: () => startFlip("next"),
              cornerNavEnabled:
                safeLeftIndex + 2 <= lastLeftIndex && flip.phase === "idle",
              cornerNavLabel:
                safeLeftIndex + 2 <= lastLeftIndex
                  ? t.agentControl.skillBookNext
                  : t.agentControl.skillBookLastPage,
            }
        : {};
      if (entry.kind === "skill") {
        return (
          <SkillBookPage
            key={`p-${entry.skill.id}-${side}`}
            skill={entry.skill}
            side={side}
            pageNumber={pageNumber}
            chapter={entry.chapter}
            equipsByAgentId={equipsByAgentId}
            agents={agents}
            globallyEquipped={
              !!Object.values(equipsByAgentId)
                .flat()
                .find((e) => e.skillId === entry.skill.id)
            }
            isAdmin={isAdmin}
            onTest={onTest}
            onEdit={onEdit}
            {...cornerNavProps}
          />
        );
      }
      if (entry.kind === "create") {
        return (
          <SkillBookEmptyPage
            key={`p-create-${side}-${pageNumber}`}
            side={side}
            variant="create"
            isAdmin={isAdmin}
            onCreate={onCreate}
            {...cornerNavProps}
          />
        );
      }
      return (
        <SkillBookEmptyPage
          key={`p-blank-${side}-${pageNumber}`}
          side={side}
          variant="blank"
          isAdmin={isAdmin}
          {...cornerNavProps}
        />
      );
    },
    [
      agents,
      equipsByAgentId,
      isAdmin,
      onCreate,
      onEdit,
      onTest,
      startFlip,
      safeLeftIndex,
      lastLeftIndex,
      flip.phase,
      t.agentControl.skillBookPrev,
      t.agentControl.skillBookNext,
      t.agentControl.skillBookFirstPage,
      t.agentControl.skillBookLastPage,
    ],
  );

  const currentPair = pairAt(safeLeftIndex);
  const destPair =
    flip.phase === "flipping" ? pairAt(flip.to) : null;

  const pageNumberFor = (side: "left" | "right", leftIdx: number) =>
    leftIdx + (side === "left" ? 1 : 2);

  const canPrev = safeLeftIndex > 0 && flip.phase === "idle";
  const canNext = safeLeftIndex + 2 <= lastLeftIndex && flip.phase === "idle";

  return (
    <div className="flex flex-col gap-2 w-full h-full min-h-0">
      <div
        ref={containerRef}
        tabIndex={0}
        className="book-stage outline-none focus:ring-0 flex-1 min-h-0"
        aria-roledescription="book"
      >
        <button
          type="button"
          onClick={() => startFlip("prev")}
          disabled={!canPrev}
          aria-label={t.agentControl.skillBookPrev}
          className={[
            "shrink-0 self-stretch w-10 mr-2 flex items-center justify-center text-secondary/70 hover:text-secondary transition-colors",
            canPrev ? "" : "opacity-30 cursor-not-allowed",
          ].join(" ")}
        >
          <span className="material-symbols-outlined text-[24px]">chevron_left</span>
        </button>

        <div className="relative book-spread">
          {safeLeftIndex > 0 && <span className="book-stack-edge book-stack-edge--left" aria-hidden />}
          {safeLeftIndex + 2 <= lastLeftIndex && (
            <span className="book-stack-edge book-stack-edge--right" aria-hidden />
          )}

          {destPair && (
            <div className="book-spread-layer" style={{ zIndex: 0 }} aria-hidden>
              {renderEntry(destPair[0], "left", pageNumberFor("left", flip.phase === "flipping" ? flip.to : safeLeftIndex))}
              {renderEntry(destPair[1], "right", pageNumberFor("right", flip.phase === "flipping" ? flip.to : safeLeftIndex))}
            </div>
          )}

          <div
            className={[
              "book-spread-layer",
              flip.phase === "flipping" && flip.direction === "prev"
                ? "[&>.book-page--left]:invisible"
                : "",
              flip.phase === "flipping" && flip.direction === "next"
                ? "[&>.book-page--right]:invisible"
                : "",
            ].join(" ")}
            style={{ zIndex: 1 }}
          >
            {renderEntry(currentPair[0], "left", pageNumberFor("left", safeLeftIndex), { interactive: true })}
            {renderEntry(currentPair[1], "right", pageNumberFor("right", safeLeftIndex), { interactive: true })}
          </div>

          <span className="book-spine" aria-hidden />

          {flip.phase === "flipping" && destPair && (
            <div
              className={[
                "book-flipper",
                flip.direction === "next" ? "book-flipper--next" : "book-flipper--prev",
                flip.armed ? "is-flipping" : "",
              ].join(" ")}
              onTransitionEnd={onFlipEnd}
              aria-hidden
            >
              <div className="book-flipper-face">
                {flip.direction === "next"
                  ? renderEntry(currentPair[1], "right", pageNumberFor("right", flip.from))
                  : renderEntry(currentPair[0], "left", pageNumberFor("left", flip.from))}
              </div>
              <div className="book-flipper-face book-flipper-face--back">
                {flip.direction === "next"
                  ? renderEntry(destPair[0], "left", pageNumberFor("left", flip.to))
                  : renderEntry(destPair[1], "right", pageNumberFor("right", flip.to))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => startFlip("next")}
          disabled={!canNext}
          aria-label={t.agentControl.skillBookNext}
          className={[
            "shrink-0 self-stretch w-10 ml-2 flex items-center justify-center text-secondary/70 hover:text-secondary transition-colors",
            canNext ? "" : "opacity-30 cursor-not-allowed",
          ].join(" ")}
        >
          <span className="material-symbols-outlined text-[24px]">chevron_right</span>
        </button>
      </div>

      {/* Page-range progress: show the two visible page numbers.
          `total` is the count of real SKILL pages — matches the per-level
          chapter total shown in each page header (so the denominator the
          user sees at the top and bottom of the book agrees). The admin
          "create" entry and any blank pad page sit OUTSIDE this count. */}
      <div
        className="font-label text-[9px] tracking-[0.3em] text-secondary/70 uppercase text-center"
        aria-live="polite"
      >
        {(() => {
          const total = entries.filter((e) => e.kind === "skill").length;
          const leftIsSkill = entries[safeLeftIndex]?.kind === "skill";
          const rightIsSkill = entries[safeLeftIndex + 1]?.kind === "skill";
          if (!leftIsSkill && !rightIsSkill) {
            // Only non-skill entries visible (admin create / blank).
            // Render a "—" placeholder so the strip keeps its height and
            // the book doesn't jump upward when landing on this spread.
            return "—";
          }
          if (leftIsSkill && rightIsSkill) {
            return format(t.agentControl.skillBookProgressRange, {
              from: safeLeftIndex + 1,
              to: safeLeftIndex + 2,
              total,
            });
          }
          // Exactly one side is a skill page.
          const onlySkillIndex = leftIsSkill ? safeLeftIndex + 1 : safeLeftIndex + 2;
          return format(t.agentControl.skillBookProgress, {
            n: onlySkillIndex,
            total,
          });
        })()}
      </div>
    </div>
  );
}
