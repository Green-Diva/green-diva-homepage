import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/types";

export type RarityFilter = "ALL" | "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";

const FILTER_OPTIONS: RarityFilter[] = ["ALL", "COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"];

function labelFor(t: Dictionary, k: RarityFilter): string {
  switch (k) {
    case "ALL":
      return t.relicCollection.filterAll;
    case "COMMON":
      return t.relicCollection.filterCommon;
    case "RARE":
      return t.relicCollection.filterRare;
    case "EPIC":
      return t.relicCollection.filterEpic;
    case "LEGENDARY":
      return t.relicCollection.filterLegendary;
    case "SPECIAL":
      return t.relicCollection.filterSpecial;
  }
}

function hrefFor(k: RarityFilter): string {
  return k === "ALL" ? "/relic-collection" : `/relic-collection?rarity=${k}`;
}

export default function SidebarFilter({
  active,
  t,
}: {
  active: RarityFilter;
  t: Dictionary;
}) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col gap-2 w-56 shrink-0 border border-primary/15 bg-surface-container/40 p-4 backdrop-blur">
        <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-2 px-1">
          {t.relicCollection.sidebarTitle}
        </h2>
        {FILTER_OPTIONS.map((k) => {
          const isActive = k === active;
          return (
            <Link
              key={k}
              href={hrefFor(k)}
              className={
                "px-3 py-2 font-label text-[11px] tracking-[0.2em] uppercase transition-all border " +
                (isActive
                  ? "bg-primary/15 border-primary/40 text-primary shadow-[inset_0_0_12px_rgba(82,253,207,0.18)]"
                  : "border-transparent text-on-surface-variant hover:bg-primary/5 hover:text-primary touch:bg-primary/5")
              }
            >
              {labelFor(t, k)}
            </Link>
          );
        })}
      </aside>

      {/* Mobile horizontal chips */}
      <nav className="lg:hidden -mx-4 px-4 overflow-x-auto flex gap-2 pb-2 scrollbar-thin">
        {FILTER_OPTIONS.map((k) => {
          const isActive = k === active;
          return (
            <Link
              key={k}
              href={hrefFor(k)}
              className={
                "shrink-0 px-3 py-2 font-label text-[11px] tracking-[0.2em] uppercase transition-all border whitespace-nowrap " +
                (isActive
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-primary/15 text-on-surface-variant hover:bg-primary/5 hover:text-primary touch:bg-primary/5")
              }
            >
              {labelFor(t, k)}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
