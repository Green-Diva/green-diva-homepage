import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n/server";

type Props = {
  title: string;
  eyebrow?: string;
};

export default async function PlaceholderPage({ title, eyebrow }: Props) {
  await getDictionary();
  const locale = await getLocale();
  const isZh = locale === "zh";
  const subtitle = isZh ? "圣殿尚在显化中" : "The chamber is still manifesting";
  const back = isZh ? "返回神谕" : "Return to the Oracle";

  return (
    <div className="min-h-screen flex flex-col w-full">
      <header className="w-full z-50 flex justify-between items-center px-5 md:px-10 py-[10px] md:py-1 bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0 gap-3">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
        >
          Green Diva
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-xl text-center space-y-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-secondary/30 bg-secondary/5 font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            {isZh ? "即将开启" : "Coming Soon"}
          </span>
          {eyebrow ? (
            <span className="font-label text-secondary tracking-[0.3em] text-[11px] uppercase block">
              {eyebrow}
            </span>
          ) : null}
          <h1 className="font-headline text-4xl sm:text-5xl font-light text-primary sacred-glow leading-[1.05] tracking-[-0.02em]">
            {title}
          </h1>
          <p className="font-body text-on-surface-variant text-[14px] font-light leading-[1.7]">
            {subtitle}
          </p>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-block px-8 py-3 bg-primary/5 backdrop-blur-md border border-primary/20 text-[11px] font-label text-primary uppercase tracking-[0.2em] hover:bg-primary/20 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              {back}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
