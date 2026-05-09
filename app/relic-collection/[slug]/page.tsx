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
import PhotoCarousel from "./_components/PhotoCarousel";
import AdminToolbar from "./_components/AdminToolbar";
import LogPanel from "./_components/LogPanel";
import PipelineTracePanel from "./_components/PipelineTracePanel";
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

      <main className="flex-1 px-4 md:px-10 py-4 md:py-6 w-full max-w-[1440px] mx-auto flex flex-col lg:min-h-0 lg:overflow-hidden">
        <div className="mb-3 shrink-0">
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
            {/* Left: 3-tab asset switcher (原图 / 2D 增强 / 3D 立体). The
                latter two are admin-triggered and run async via AgentJob. */}
            <div className="lg:col-span-7 lg:min-h-0 lg:flex lg:flex-col relative">
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

              {!isExtracted ? (
                <div className="absolute top-3 left-3 right-3 z-10">
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
                        {relic.archivePath ? (
                          <a
                            href={`/api/relics/${relic.id}/archive`}
                            className="inline-flex items-center gap-2 px-3 py-1.5 border border-primary/40 hover:bg-primary/10 font-label text-[11px] tracking-[0.2em] uppercase text-primary"
                          >
                            <span className="material-symbols-outlined text-[16px]">archive</span>
                            {t.relicCollection.archiveDownload}
                          </a>
                        ) : (
                          <span
                            aria-disabled="true"
                            title={t.relicCollection.downloadUnavailable}
                            className="inline-flex items-center gap-2 px-3 py-1.5 border border-on-surface-variant/20 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/40 cursor-not-allowed select-none"
                          >
                            <span className="material-symbols-outlined text-[16px]">archive</span>
                            {t.relicCollection.archiveDownload}
                          </span>
                        )}
                        {relic.derivedArchivePath ? (
                          <a
                            href={`/api/relics/${relic.id}/derived`}
                            className="inline-flex items-center gap-2 px-3 py-1.5 border border-secondary/40 hover:bg-secondary/10 font-label text-[11px] tracking-[0.2em] uppercase text-secondary"
                          >
                            <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                            {t.relicCollection.derivedDownload}
                          </a>
                        ) : (
                          <span
                            aria-disabled="true"
                            title={t.relicCollection.downloadUnavailable}
                            className="inline-flex items-center gap-2 px-3 py-1.5 border border-on-surface-variant/20 font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/40 cursor-not-allowed select-none"
                          >
                            <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                            {t.relicCollection.derivedDownload}
                          </span>
                        )}
                      </>
                    }
                  />
                </div>
              ) : null}
            </div>

            {/* Right: metadata */}
            <div className="lg:col-span-5 lg:min-h-0 flex flex-col lg:overflow-y-auto lg:pr-2 lg:-mr-2 scrollbar-thin">
              <section className="border border-primary/15 bg-surface-container/30 p-4 flex flex-col gap-4 lg:flex-1">
              <div className="flex items-start gap-3 flex-wrap">
                <span className={"px-3 py-1.5 border font-label text-[10px] tracking-[0.25em] uppercase " + rarityColor(relic.rarity)}>
                  {rarityLabel(t, relic.rarity)}
                </span>
                <span className="px-3 py-1.5 border border-primary/30 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
                  {t.relicCollection.slotNo} · {String(relic.slot).padStart(3, "0")}
                </span>
                {isExtracted ? (
                  <span className="px-3 py-1.5 border border-on-surface-variant/40 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant bg-on-surface-variant/5">
                    {t.relicCollection.extractedTag}
                    {relic.extractedBy ? ` · ${format(t.relicCollection.extractedBy, { name: relic.extractedBy.name })}` : ""}
                  </span>
                ) : null}
              </div>

              <div>
                <p className="font-label text-[11px] tracking-[0.3em] uppercase text-secondary mb-2">
                  {classif}
                </p>
                <h1 className="font-headline text-3xl md:text-4xl text-primary sacred-glow leading-[1.15]">
                  {name}
                </h1>
                {relic.formKind && relic.formReason ? (
                  <p className="mt-3 font-body text-[12px] text-on-surface-variant/75 leading-[1.6] italic">
                    <span className="font-label text-[9px] tracking-[0.25em] uppercase text-on-surface-variant/60 mr-2 not-italic">
                      {relic.formKind === "TWO_D"
                        ? locale === "zh"
                          ? "判定 · 平面"
                          : "Classified · 2D"
                        : locale === "zh"
                          ? "判定 · 立体"
                          : "Classified · 3D"}
                    </span>
                    {relic.formReason}
                  </p>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-primary/10 py-5">
                <div>
                  <dt className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant/70 mb-1">
                    {t.relicCollection.acquired}
                  </dt>
                  <dd className="font-body text-[13px] text-on-surface">
                    {relic.acquiredAt
                      ? new Date(relic.acquiredAt).toISOString().slice(0, 10)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-label text-[9px] tracking-[0.3em] uppercase text-on-surface-variant/70 mb-1">
                    {t.relicCollection.origin}
                  </dt>
                  <dd className="font-body text-[13px] text-on-surface">
                    {relic.origin || "—"}
                  </dd>
                </div>
              </dl>

              {lore ? (
                <div>
                  <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-3">
                    {t.relicCollection.lore}
                  </h2>
                  <div className="font-body text-[14px] text-on-surface-variant leading-[1.8] prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{lore}</ReactMarkdown>
                  </div>
                </div>
              ) : null}

              {relic.photoPaths.length > 0 ? (
                <div>
                  <h2 className="font-label text-[10px] tracking-[0.3em] uppercase text-secondary mb-3">
                    {locale === "zh" ? "影像" : "Photos"}
                  </h2>
                  <PhotoCarousel
                    relicId={relic.id}
                    count={relic.photoPaths.length}
                    alt={name}
                  />
                </div>
              ) : null}

              </section>
              {isAdmin ? (
                <div className="mt-4 lg:mt-auto lg:pt-4 space-y-3">
                  <PipelineTracePanel
                    trace={relic.pipelineTrace}
                    locale={locale}
                    t={t}
                  />
                  <LogPanel relicId={relic.id} />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
