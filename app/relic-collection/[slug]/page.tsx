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
import LanguageSwitcher from "@/components/LanguageSwitcher";
import RelicViewer from "./_components/RelicViewer";
import PhotoCarousel from "./_components/PhotoCarousel";
import AdminToolbar from "./_components/AdminToolbar";
import LogPanel from "./_components/LogPanel";
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
      return t.relicCollection.rarityNoBoundary;
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
  const relic = await prisma.relic.findUnique({ where: { slug } });
  if (!relic) notFound();

  const [t, locale, user, unlockedIds] = await Promise.all([
    getDictionary(),
    getLocale(),
    getCurrentUser(),
    getUnlockedRelicIds(),
  ]);
  const sharedIds = await getSharedRelicIds(user?.id);
  const access = canAccessRelic(relic, user, unlockedIds, sharedIds);
  const isAdmin = (user?.level ?? 0) >= ADMIN_LEVEL;
  const isShared = access.ok && access.reason === "shared";

  const name = locale === "zh" ? relic.nameZh : relic.nameEn;
  const classif = locale === "zh" ? relic.classifZh : relic.classifEn;
  const lore = locale === "zh" ? relic.loreZh : relic.loreEn;

  return (
    <div className="flex flex-col flex-1 w-full bg-background text-on-background">
      <header className="w-full z-50 flex justify-between items-center px-5 md:px-10 py-2 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)]"
        >
          Green Diva
        </Link>
        <LanguageSwitcher />
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

        {access.ok && isAdmin ? (
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
            />
          </div>
        ) : null}

        {!access.ok ? (
          <div className="max-w-xl mx-auto text-center py-10 space-y-5 border border-error/30 bg-surface-container/30 p-10 shrink-0">
            <span className="material-symbols-outlined text-error text-[48px]">lock</span>
            <h1 className="font-headline text-2xl tracking-wide uppercase text-on-surface">
              {access.reason === "needs-level"
                ? t.relicCollection.needLevelTitle
                : t.relicCollection.needPasswordTitle}
            </h1>
            <p className="font-body text-[14px] text-on-surface-variant leading-[1.7]">
              {access.reason === "needs-level"
                ? format(t.relicCollection.needLevelBody, { required: access.required })
                : t.relicCollection.needPasswordBody}
            </p>
            {access.reason === "needs-password" ? (
              <UnlockTrigger
                relicId={relic.id}
                reason="needs-password"
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
            {/* Left: 3D viewer */}
            <div className="lg:col-span-7 lg:min-h-0 lg:flex lg:flex-col">
              {relic.modelPath ? (
                <RelicViewer
                  modelUrl={`/api/relics/${relic.id}/model`}
                  alt={name}
                  t={t}
                />
              ) : relic.photoPaths.length > 0 ? (
                <div className="aspect-square w-full bg-surface-container/40 border border-primary/30 relative overflow-hidden lg:aspect-auto lg:h-full lg:max-h-full lg:flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/relics/${relic.id}/photos/0`}
                    alt={name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-square w-full bg-surface-container/40 border border-primary/20 flex items-center justify-center lg:aspect-auto lg:h-full lg:max-h-full lg:flex-1">
                  <span className="font-label text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60">
                    {t.relicCollection.noModel}
                  </span>
                </div>
              )}
            </div>

            {/* Right: metadata */}
            <div className="lg:col-span-5 flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2 lg:-mr-2 scrollbar-thin">
              <div className="flex items-start gap-3 flex-wrap">
                <span className={"px-3 py-1.5 border font-label text-[10px] tracking-[0.25em] uppercase " + rarityColor(relic.rarity)}>
                  {rarityLabel(t, relic.rarity)}
                </span>
                <span className="px-3 py-1.5 border border-primary/30 font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant">
                  {t.relicCollection.slotNo} · {String(relic.slot).padStart(3, "0")}
                </span>
                {isShared ? (
                  <span className="px-3 py-1.5 border border-[#ff9bcd]/60 font-label text-[10px] tracking-[0.25em] uppercase text-[#ff9bcd] bg-[#ff9bcd]/5">
                    {t.relicCollection.shared} · {t.relicCollection.accessShared}
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

              {isAdmin ? <LogPanel relicId={relic.id} /> : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
