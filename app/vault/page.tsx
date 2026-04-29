import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";

export const metadata = {
  title: "The Hidden Dungeon",
  robots: { index: false, follow: false },
};

export default async function VaultPage() {
  const locale = await getLocale();
  const isZh = locale === "zh";

  const eyebrow = isZh ? "隐秘地牢" : "The Hidden Dungeon";
  const title = isZh ? "你已抵达隐秘地牢" : "You Have Reached the Hidden Dungeon";
  const subtitle = isZh
    ? "这里只有你与神谕对视。说出真名，世界便会松动。"
    : "Only you and the oracle remain. Speak the true name, and the world loosens.";
  const back = isZh ? "返回神谕" : "Return to the Oracle";
  const stamp = isZh ? "访问已授权" : "ACCESS GRANTED";
  const sigGD = isZh ? "地牢" : "GD";
  const sigSEC = "SEC";

  return (
    <div className="min-h-screen w-full bg-[#03090a] text-primary relative overflow-hidden">
      {/* CRT scanlines */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.22)_0px,rgba(0,0,0,0.22)_1px,transparent_1px,transparent_3px)] mix-blend-multiply opacity-40"
      />
      {/* Vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.85)_100%)]"
      />

      <header className="relative z-10 flex items-center gap-3 px-5 md:px-10 py-3 border-b border-primary/20">
        <span className="font-label text-[10px] tracking-[0.4em] text-primary/70 uppercase">
          {sigGD} · 07
        </span>
        <span className="flex-1 h-px bg-primary/15" />
        <span className="font-label text-[10px] tracking-[0.4em] text-primary/40 uppercase">
          {sigSEC}
        </span>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center px-6 py-20 min-h-[calc(100vh-49px)]">
        <div className="max-w-xl w-full text-center space-y-6">
          {/* Stamp */}
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-10 bg-primary/40" />
            <span className="font-label text-[10px] tracking-[0.5em] text-primary uppercase animate-pulse">
              {stamp}
            </span>
            <span className="h-px w-10 bg-primary/40" />
          </div>

          <span className="font-label text-secondary tracking-[0.3em] text-[11px] uppercase block">
            {eyebrow}
          </span>

          <h1 className="font-headline text-4xl sm:text-5xl font-light text-primary sacred-glow leading-[1.05] tracking-[-0.02em]">
            {title}
          </h1>

          <p className="font-body text-on-surface-variant text-[14px] font-light leading-[1.7]">
            {subtitle}
          </p>

          {/* Decoded line */}
          <div className="mx-auto max-w-md border border-primary/25 bg-black/50 px-4 py-3 font-mono text-[11px] text-primary/70 tracking-[0.2em] text-left">
            <div>&gt; auth.session.unsealed = true</div>
            <div>&gt; payload.next = pending …</div>
            <div className="text-primary/40">&gt; awaiting ritual</div>
          </div>

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
