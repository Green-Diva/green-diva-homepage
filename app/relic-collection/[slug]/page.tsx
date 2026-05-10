import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";
import { canAccessRelic, getUnlockedRelicIds } from "@/lib/relicAccess";
import { getSharedRelicIds } from "@/lib/relicShare";
import { getGrantedRelicIds } from "@/lib/relicGrant";
import UserMenu from "@/components/UserMenu";
import AssetTabs from "./_components/AssetTabs";
import AdminToolbar from "./_components/AdminToolbar";
import LogPanel from "./_components/LogPanel";
import RelicProcessingBanner from "./_components/RelicProcessingBanner";
import AwaitingReviewBanner from "./_components/AwaitingReviewBanner";
import UnlockTrigger from "../_components/UnlockTrigger";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const r = await prisma.relic.findUnique({
    where: { slug },
    select: { nameEn: true, nameZh: true },
  });
  return { title: r ? `${r.nameEn} · ${r.nameZh}` : "Relic" };
}

function rarityLabel(t: Awaited<ReturnType<typeof getDictionary>>, r: string): string {
  switch (r) {
    case "COMMON":
      return t.relicCollection.rarityCommon;
    case "RARE":
      return t.relicCollection.rarityRare;
    case "EPIC":
      return t.relicCollection.rarityEpic;
    case "LEGENDARY":
      return t.relicCollection.rarityLegendary;
    case "SPECIAL":
      return t.relicCollection.raritySpecialItem;
    default:
      return r;
  }
}

function rarityColor(r: string): string {
  switch (r) {
    case "RARE":
      return "border-[#80c8ff]/50 text-[#80c8ff] bg-[#80c8ff]/5";
    case "EPIC":
      return "border-[#c79bff]/50 text-[#c79bff] bg-[#c79bff]/5";
    case "LEGENDARY":
      return "border-secondary/50 text-secondary bg-secondary/10";
    case "SPECIAL":
      return "border-[#ff9bcd]/50 text-[#ff9bcd] bg-[#ff9bcd]/5";
    default:
      return "border-on-surface-variant/30 text-on-surface-variant bg-surface-container/40";
  }
}

// Rarity accent for the title-card icon + LED indicator. Mirrors the grid
// cell's color logic (see VaultCell.tsx::rarityAccent / LED class) so the
// detail page reads as the "expanded" form of the same cell.
function rarityAccentText(r: string): string {
  switch (r) {
    case "RARE":
      return "text-[#80c8ff]";
    case "EPIC":
      return "text-[#c79bff]";
    case "LEGENDARY":
      return "text-secondary";
    case "SPECIAL":
      return "text-[#ff9bcd]";
    default:
      return "text-on-surface-variant";
  }
}

function rarityLedClass(r: string): string {
  // Same shape/glow as VaultCell so the detail page reads as the same cell
  // grown larger; only the color hue differs by rarity.
  switch (r) {
    case "RARE":
      return "bg-[#80c8ff] shadow-[0_0_4px_currentColor,0_0_12px_currentColor] text-[#80c8ff]";
    case "EPIC":
      return "bg-[#c79bff] shadow-[0_0_4px_currentColor,0_0_12px_currentColor] text-[#c79bff]";
    case "LEGENDARY":
      return "bg-secondary shadow-[0_0_4px_currentColor,0_0_12px_currentColor] text-secondary";
    case "SPECIAL":
      return "bg-[#ff9bcd] shadow-[0_0_4px_currentColor,0_0_12px_currentColor] text-[#ff9bcd]";
    default:
      return "bg-on-surface-variant/60 text-on-surface-variant";
  }
}

// Unified panel border tint by rarity. Applied to every detail-page module
// (identity card, lore, photos, activity log) so the page reads as one
// cohesive "expanded cell" colored by the relic's rarity.
function rarityBorder(r: string): string {
  switch (r) {
    case "RARE":
      return "border-[#80c8ff]/40";
    case "EPIC":
      return "border-[#c79bff]/40";
    case "LEGENDARY":
      return "border-secondary/40";
    case "SPECIAL":
      return "border-[#ff9bcd]/40";
    default:
      return "border-primary/20";
  }
}

function rarityBorderSoft(r: string): string {
  switch (r) {
    case "RARE":
      return "border-[#80c8ff]/30";
    case "EPIC":
      return "border-[#c79bff]/30";
    case "LEGENDARY":
      return "border-secondary/30";
    case "SPECIAL":
      return "border-[#ff9bcd]/30";
    default:
      return "border-primary/15";
  }
}

export default async function RelicDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const relic = await prisma.relic.findUnique({
    where: { slug },
    include: { extractedBy: { select: { id: true, name: true } } },
  });
  if (!relic) notFound();

  const [t, locale, user, unlockedIds] = await Promise.all([
    getDictionary(),
    getLocale(),
    getCurrentUser(),
    getUnlockedRelicIds(),
  ]);
  const isAdmin = (user?.level ?? 0) >= ADMIN_LEVEL;

  const [sharedIds, grantedIds] = await Promise.all([
    getSharedRelicIds(user?.id),
    getGrantedRelicIds(user?.id ?? null),
  ]);

  // Extracted relics turn read-only. Visible to admin, the extractor, and any
  // user who held a grant record at extract time. YELLOW-only viewers (shared /
  // level-view) lose access once the relic is extracted.
  if (
    relic.extractedAt &&
    !isAdmin &&
    relic.extractedById !== user?.id &&
    !grantedIds.has(relic.id)
  ) {
    notFound();
  }

  // Pipeline-finished but admin hasn't confirmed yet → admin only. Hide
  // even from grant-holders / shared / unlocked viewers, since the relic
  // is still mid-curation.
  if (relic.status === "AWAITING_REVIEW" && !isAdmin) {
    notFound();
  }

  const access = canAccessRelic(relic, user, unlockedIds, sharedIds, grantedIds);
  const isExtracted = !!relic.extractedAt;

  const name = locale === "zh" ? relic.nameZh : relic.nameEn;
  const classif = locale === "zh" ? relic.classifZh : relic.classifEn;
  const lore = locale === "zh" ? relic.loreZh : relic.loreEn;
  // One-sentence summary derived from the lore's first paragraph (the
  // Researcher's "WHAT IT IS" section). Strips markdown emphasis + clips at
  // the first terminator (Chinese 。/ ！/ ？ or English . / ! / ?). No
  // re-runs needed for legacy relics — works off the lore already in DB.
  const summary = (() => {
    if (!lore) return null;
    const firstPara = lore.split(/\n\s*\n/)[0] ?? lore;
    const stripped = firstPara
      .replace(/[*_~`]+/g, "")
      .replace(/^#+\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped) return null;
    const m = stripped.match(/^[^。.!?！？]+[。.!?！？]/);
    const sentence = (m ? m[0] : stripped).trim();
    return sentence.length > 80 ? sentence.slice(0, 80) + "…" : sentence;
  })();

  return (
    <div className="flex flex-col flex-1 w-full bg-background text-on-background">
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

      <main className="flex-1 px-4 md:px-10 py-3 md:py-4 w-full max-w-[1440px] mx-auto flex flex-col lg:h-[calc(100dvh-71px)] lg:flex-none lg:overflow-hidden">
        <div className="mb-2 shrink-0 flex items-center justify-between gap-3">
          <Link
            href="/relic-collection"
            className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary"
          >
            ← {t.relicCollection.pageTitle}
          </Link>
        </div>

        {relic.status === "AWAITING_REVIEW" && isAdmin ? (
          <AwaitingReviewBanner
            relic={{
              id: relic.id,
              slot: relic.slot,
              slug: relic.slug,
              nameEn: relic.nameEn,
              nameZh: relic.nameZh,
              rarity: relic.rarity,
              hasPassword: !!relic.passwordHash,
            }}
          />
        ) : relic.status !== "READY" &&
          relic.status !== "AWAITING_REVIEW" &&
          access.level !== "RED" ? (
          <RelicProcessingBanner
            relicId={relic.id}
            initialStatus={relic.status}
            isAdmin={isAdmin}
          />
        ) : null}

        {access.level === "RED" ? (
          <div className="max-w-xl mx-auto text-center py-10 space-y-5 border border-error/30 bg-surface-container/30 p-10 shrink-0">
            <span className="material-symbols-outlined text-error text-[48px]">lock</span>
            <h1 className="font-headline text-2xl tracking-wide uppercase text-on-surface">
              {access.reason === "locked-level"
                ? t.relicCollection.needLevelTitle
                : t.relicCollection.needPasswordTitle}
            </h1>
            <p className="font-body text-[14px] text-on-surface-variant leading-[1.7]">
              {access.reason === "locked-level"
                ? format(t.relicCollection.needLevelBody, { required: access.required ?? 0 })
                : t.relicCollection.needPasswordBody}
            </p>
            {access.reason === "locked-password" ? (
              <UnlockTrigger
                relicId={relic.id}
                reason="locked-password"
                ariaLabel={t.relicCollection.unlock}
                t={t}
                className="inline-block px-6 py-3 border border-primary/60 bg-primary/10 hover:bg-primary/20 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
              >
                {t.relicCollection.unlock}
              </UnlockTrigger>
            ) : null}
          </div>
        ) : (
          <>
            {/* Admin toolbar — own row above the asset grid; no longer overlays
                the image. Compact button styling so 7 actions fit at lg width. */}
            {!isExtracted && isAdmin ? (
              <div className="mb-3 shrink-0">
                <AdminToolbar
                  relic={{
                    id: relic.id,
                    slot: relic.slot,
                    slug: relic.slug,
                    nameEn: relic.nameEn,
                    nameZh: relic.nameZh,
                    rarity: relic.rarity,
                    hasPassword: !!relic.passwordHash,
                  }}
                  accessReason={access.reason}
                  isExtracted={isExtracted}
                  rightSlot={
                    <>
                      <a
                        href={`/api/relics/${relic.id}/archive`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-primary/40 hover:bg-primary/10 font-label text-[10px] tracking-[0.2em] uppercase text-primary"
                      >
                        <span className="material-symbols-outlined text-[14px]">archive</span>
                        {t.relicCollection.archiveDownload}
                      </a>
                      <a
                        href={`/api/relics/${relic.id}/derived`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-secondary/40 hover:bg-secondary/10 font-label text-[10px] tracking-[0.2em] uppercase text-secondary"
                      >
                        <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                        {t.relicCollection.derivedDownload}
                      </a>
                    </>
                  }
                />
              </div>
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
              {/* Left: 3-tab asset switcher (原图 / 2D 增强 / 3D 立体). The
                latter two are admin-triggered and run async via AgentJob. */}
              <div className="lg:col-span-7 lg:min-h-0 lg:flex lg:flex-col">
                <AssetTabs
                  relicId={relic.id}
                  hasPrimary={!!relic.primaryImagePath}
                  hasEnhanced={!!relic.enhancedImagePath}
                  hasModel={!!relic.modelPath}
                  formKind={relic.formKind}
                  alt={name}
                  isAdmin={isAdmin}
                  t={t}
                />
              </div>

              {/* Right: metadata stack of independent modules. Column itself
                does NOT scroll; only the lore body inside its module does.
                Activity log module is pinned at the bottom. */}
              <div className="lg:col-span-5 lg:min-h-0 flex flex-col gap-3">
                {/* Module 1 — identity card. Two-column layout: small thumbnail
                  on the left, key info stack on the right (slot / name /
                  subtitle / rarity). Corner ornaments + LED echo the grid
                  cell aesthetic. */}
                <div className={
                  "shrink-0 relative border bg-surface-container/30 p-3 " +
                  rarityBorder(relic.rarity)
                }>
                  {/* Corner ornaments — same L-marks as VaultCell. */}
                  <span className="absolute top-0 left-0 w-2 h-2 border-l border-t border-primary/60" />
                  <span className="absolute top-0 right-0 w-2 h-2 border-r border-t border-primary/60" />
                  <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-primary/60" />
                  <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-primary/60" />

                  {/* LED top-right, rarity-hued + glowing. */}
                  <span
                    className={"absolute top-2 right-3 w-2 h-2 rounded-full " + rarityLedClass(relic.rarity)}
                    aria-hidden
                  />

                  <div className="flex items-stretch gap-3">
                    {/* Left — square thumbnail. Fallback to Material icon when
                      no primary image exists yet. */}
                    <div className={
                      "shrink-0 w-20 h-20 border bg-background/60 relative overflow-hidden flex items-center justify-center " +
                      rarityBorderSoft(relic.rarity)
                    }>
                      {relic.primaryImagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/relics/${relic.id}/primary`}
                          alt={name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span
                          className={"material-symbols-outlined text-[28px] " + rarityAccentText(relic.rarity)}
                          style={{ fontVariationSettings: "'FILL' 0, 'wght' 200" }}
                          aria-hidden
                        >
                          {relic.iconKey || "inventory_2"}
                        </span>
                      )}
                    </div>

                    {/* Right — info stack. */}
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <span className="font-label text-[10px] tracking-[0.3em] text-on-surface-variant/75">
                        {t.relicCollection.slotNo} · {String(relic.slot).padStart(3, "0")}
                      </span>
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <h1 className="font-headline text-[22px] md:text-[24px] text-primary sacred-glow leading-[1.15] truncate min-w-0">
                          {name}
                        </h1>
                        <span className={"shrink-0 px-2 py-0.5 border font-label text-[9px] tracking-[0.25em] uppercase " + rarityColor(relic.rarity)}>
                          {rarityLabel(t, relic.rarity)}
                        </span>
                      </div>
                      <p className="font-label text-[10px] tracking-[0.25em] uppercase text-secondary opacity-90 truncate">
                        {classif}
                      </p>
                      {isExtracted ? (
                        <div className="mt-1">
                          <span className="px-2 py-0.5 border border-on-surface-variant/40 font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant bg-on-surface-variant/5">
                            {t.relicCollection.extractedTag}
                            {relic.extractedBy ? ` · ${format(t.relicCollection.extractedBy, { name: relic.extractedBy.name })}` : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {summary ? (
                    <p className="mt-3 font-body text-[12px] text-on-surface-variant/85 leading-[1.55] italic">
                      {summary}
                    </p>
                  ) : null}
                </div>

                {/* Module 3 — lore. Body has internal overflow with a visible
                  themed scrollbar so the user sees "this scrolls". */}
                {lore ? (
                  <div className={
                    "flex flex-col border bg-surface-container/30 p-4 lg:flex-1 lg:min-h-0 " +
                    rarityBorder(relic.rarity)
                  }>
                    <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-3 shrink-0">
                      {t.relicCollection.lore}
                    </h2>
                    <div className="font-body text-[14px] text-on-surface-variant leading-[1.8] prose prose-invert prose-sm max-w-none lg:flex-1 lg:min-h-0 lg:overflow-y-auto pr-2 -mr-2 lore-scrollbar">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{lore}</ReactMarkdown>
                    </div>
                  </div>
                ) : null}

                {/* Module 4 — activity log, pinned at bottom of column. */}
                {isAdmin ? (
                  <div className="shrink-0">
                    <LogPanel relicId={relic.id} rarity={relic.rarity} />
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
