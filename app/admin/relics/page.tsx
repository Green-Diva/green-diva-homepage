import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import RelicsTable from "./RelicsTable";

export default async function AdminRelicsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/admin/relics");
  if (me.level < ADMIN_LEVEL) redirect("/");

  const t = await getDictionary();
  const relics = await prisma.relic.findMany({
    orderBy: { slot: "asc" },
    select: {
      id: true,
      slot: true,
      slug: true,
      nameEn: true,
      nameZh: true,
      rarity: true,
      modelPath: true,
      passwordHash: true,
    },
  });

  // strip passwordHash before sending to client
  const rows = relics.map((r) => ({
    id: r.id,
    slot: r.slot,
    slug: r.slug,
    nameEn: r.nameEn,
    nameZh: r.nameZh,
    rarity: r.rarity,
    hasModel: !!r.modelPath,
    hasPassword: !!r.passwordHash,
  }));

  return (
    <div className="min-h-screen flex flex-col w-full bg-background text-on-background">
      <header className="w-full z-50 flex justify-between items-center px-5 md:px-10 py-2 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)]"
        >
          Green Diva
        </Link>
      </header>
      <main className="flex-1 px-4 md:px-10 py-6 md:py-10 w-full max-w-[1280px] mx-auto">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <Link
              href="/"
              className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary"
            >
              {t.adminRelics.backToSanctuary}
            </Link>
            <h1 className="font-headline text-2xl md:text-3xl tracking-[0.05em] uppercase text-primary sacred-glow mt-1">
              {t.adminRelics.pageTitle}
            </h1>
            <p className="font-label text-[11px] tracking-[0.25em] uppercase text-on-surface-variant mt-1">
              {t.adminRelics.pageSubtitle}
            </p>
          </div>
        </div>

        <RelicsTable rows={rows} />
      </main>
    </div>
  );
}
