import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { getSharedRelicIds } from "@/lib/relicShare";
import VaultCell, { type CellRelic } from "./_components/VaultCell";
import SidebarFilter, { type RarityFilter } from "./_components/SidebarFilter";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export const metadata: Metadata = {
  title: "Asset Vault",
};

const TOTAL_SLOTS = 30;
const VALID_FILTERS: RarityFilter[] = ["ALL", "COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"];

export default async function RelicCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ rarity?: string }>;
}) {
  const sp = await searchParams;
  const rarityRaw = (sp.rarity ?? "ALL").toUpperCase();
  const filter: RarityFilter = (VALID_FILTERS as string[]).includes(rarityRaw)
    ? (rarityRaw as RarityFilter)
    : "ALL";

  const [t, locale, user, unlockedIds, allRelics] = await Promise.all([
    getDictionary(),
    getLocale(),
    getCurrentUser(),
    getUnlockedRelicIds(),
    prisma.relic.findMany({
      orderBy: { slot: "asc" },
      select: {
        id: true,
        slot: true,
        slug: true,
        nameEn: true,
        nameZh: true,
        classifEn: true,
        classifZh: true,
        rarity: true,
        iconKey: true,
      },
    }),
  ]);

  const sharedIds = await getSharedRelicIds(user?.id);
  const isAdmin = (user?.level ?? 0) >= ADMIN_LEVEL;
  const statusLabel = isAdmin
    ? t.relicCollection.statusHighLord
    : user
      ? t.relicCollection.statusInitiate
      : t.relicCollection.statusGuest;

  // Decide which relics pass the filter
  const filtered: CellRelic[] = (filter === "ALL"
    ? allRelics
    : allRelics.filter((r) => r.rarity === filter)
  ) as CellRelic[];

  const slotMap = new Map<number, CellRelic>();
  for (const r of filtered) slotMap.set(r.slot, r);

  const filledCount = allRelics.length;

  return (
    <div className="min-h-screen flex flex-col w-full bg-background text-on-background">
      {/* Top bar */}
      <header className="w-full z-50 flex justify-between items-center px-5 md:px-10 py-2 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
        >
          Green Diva
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 px-4 md:px-10 py-6 md:py-10 w-full max-w-[1440px] mx-auto">
        {/* Title row */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6 md:mb-10">
          <div className="flex flex-col gap-2">
            <Link
              href="/"
              className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary w-fit"
            >
              {t.relicCollection.backToVault}
            </Link>
            <h1 className="font-headline text-3xl md:text-4xl tracking-[0.05em] text-primary uppercase sacred-glow">
              {t.relicCollection.pageTitle}
            </h1>
            <p className="font-label text-[11px] tracking-[0.25em] uppercase text-on-surface-variant">
              {t.relicCollection.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1.5 border border-primary/40 font-label text-[10px] tracking-[0.25em] uppercase text-primary bg-primary/5">
              {format(t.relicCollection.capacity, { filled: filledCount, total: TOTAL_SLOTS })}
            </span>
            <span
              className={
                "px-3 py-1.5 border font-label text-[10px] tracking-[0.25em] uppercase " +
                (isAdmin
                  ? "border-secondary/50 text-secondary bg-secondary/10"
                  : user
                    ? "border-secondary/40 text-secondary bg-secondary/5"
                    : "border-on-surface-variant/30 text-on-surface-variant bg-surface-container/40")
              }
            >
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Layout: sidebar + grid */}
        <div className="flex flex-col lg:flex-row gap-6">
          <SidebarFilter active={filter} t={t} />

          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-px bg-primary/10 p-px border border-primary/20">
              {Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).map((slot) => {
                const relic = slotMap.get(slot) ?? null;
                const access = relic ? canAccessRelic(relic, user, unlockedIds, sharedIds) : null;
                return (
                  <VaultCell
                    key={slot}
                    slot={slot}
                    relic={relic}
                    access={access}
                    locale={locale}
                    t={t}
                    isAdmin={isAdmin}
                  />
                );
              })}
            </div>

            <p className="mt-4 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/60">
              {t.relicCollection.accessGreen} · {t.relicCollection.accessRed} ·{" "}
              {t.relicCollection.accessUnlocked}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
