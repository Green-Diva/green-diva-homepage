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
import UserMenu from "@/components/UserMenu";

export const metadata: Metadata = {
  title: "Asset Vault",
};

const TOTAL_SLOTS = 60;
const PAGE_SIZE = 50;
const VALID_FILTERS: RarityFilter[] = ["ALL", "COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"];

export default async function RelicCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ rarity?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const rarityRaw = (sp.rarity ?? "ALL").toUpperCase();
  const filter: RarityFilter = (VALID_FILTERS as string[]).includes(rarityRaw)
    ? (rarityRaw as RarityFilter)
    : "ALL";
  const totalPages = Math.max(1, Math.ceil(TOTAL_SLOTS / PAGE_SIZE));
  const pageRaw = parseInt(sp.page ?? "1", 10);
  const safePage =
    Number.isFinite(pageRaw) && pageRaw >= 1 && pageRaw <= totalPages ? pageRaw : 1;
  const startSlot = (safePage - 1) * PAGE_SIZE + 1;
  const endSlot = Math.min(safePage * PAGE_SIZE, TOTAL_SLOTS);

  const buildHref = (nextPage: number): string => {
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("rarity", filter);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/relic-collection?${qs}` : "/relic-collection";
  };

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
    <div className="flex flex-col flex-1 w-full bg-background text-on-background">
      {/* Top bar */}
      <header className="w-full z-50 grid grid-cols-[1fr_auto_1fr] items-center px-5 md:px-10 py-[10px] md:py-1 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0 gap-3">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm justify-self-start"
        >
          Green Diva
        </Link>
        <div className="hidden md:flex items-center gap-3 justify-self-center whitespace-nowrap" aria-label="The Relic Collection">
          <span aria-hidden className="block w-8 h-px bg-gradient-to-r from-transparent to-primary/50" />
          <span aria-hidden className="text-secondary/80 text-[10px] leading-none">◆</span>
          <span className="font-label text-[11px] tracking-[0.45em] uppercase text-primary sacred-glow">
            The Relic Collection
          </span>
          <span aria-hidden className="text-secondary/80 text-[10px] leading-none">◆</span>
          <span aria-hidden className="block w-8 h-px bg-gradient-to-l from-transparent to-primary/50" />
        </div>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-7 justify-self-end">
          {user ? (
            <UserMenu
              user={{
                name: user.name,
                level: user.level,
                avatarUrl: user.avatarUrl,
                gender: user.gender,
              }}
              isAdmin={isAdmin}
            />
          ) : null}
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 px-4 md:px-10 py-3 md:py-4 w-full max-w-[1440px] mx-auto flex flex-col lg:min-h-0 lg:overflow-hidden">
        {/* Title row */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-3 md:mb-4 shrink-0">
          <div className="flex flex-col gap-1">
            <h1 className="font-headline text-2xl md:text-3xl tracking-[0.05em] text-primary uppercase sacred-glow">
              {t.relicCollection.pageTitle}
            </h1>
            <p className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
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
        <div className="flex flex-col lg:flex-row gap-6 lg:flex-1 lg:min-h-0">
          <SidebarFilter active={filter} t={t} />

          <div className="flex-1 min-w-0 flex flex-col lg:min-h-0">
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 xl:grid-cols-10 2xl:grid-cols-10 gap-px p-px border border-primary/15 bg-surface-container/30 [background-image:radial-gradient(circle_at_center,rgba(82,253,207,0.06)_1px,transparent_1.5px)] [background-size:14px_14px] lg:flex-1 lg:min-h-0 lg:grid-rows-5">
              {Array.from({ length: endSlot - startSlot + 1 }, (_, i) => startSlot + i).map((slot) => {
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

            <nav className="mt-3 flex items-center justify-between gap-4 font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 shrink-0">
              <p className="hidden sm:block text-on-surface-variant/75 text-[10px] tracking-[0.25em]">
                {t.relicCollection.accessGreen} · {t.relicCollection.accessRed} ·{" "}
                {t.relicCollection.accessUnlocked}
              </p>
              <div className="flex items-center gap-2 ml-auto">
                {safePage > 1 ? (
                  <Link
                    href={buildHref(safePage - 1)}
                    className="border border-primary/20 px-3 py-1.5 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {t.adminUsers.prevPage}
                  </Link>
                ) : (
                  <span className="border border-primary/10 px-3 py-1.5 opacity-30">
                    {t.adminUsers.prevPage}
                  </span>
                )}
                <span className="text-secondary tabular-nums px-1">
                  {format(t.adminUsers.pageInfo, { page: safePage, total: totalPages })}
                </span>
                {safePage < totalPages ? (
                  <Link
                    href={buildHref(safePage + 1)}
                    className="border border-primary/20 px-3 py-1.5 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {t.adminUsers.nextPage}
                  </Link>
                ) : (
                  <span className="border border-primary/10 px-3 py-1.5 opacity-30">
                    {t.adminUsers.nextPage}
                  </span>
                )}
              </div>
            </nav>
          </div>
        </div>
      </main>
    </div>
  );
}
