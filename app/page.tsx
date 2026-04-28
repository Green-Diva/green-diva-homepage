import Image from "next/image";
import Link from "next/link";
import HeroPortrait from "@/components/HeroPortrait";
import SeamlessLoopVideo from "@/components/SeamlessLoopVideo";
import UserMenu from "@/components/UserMenu";
import MobileNav from "@/components/MobileNav";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";

const HERO_PORTRAIT = "/images/hero-portrait.jpg";
const VISUAL_WITNESS = "/images/visual-witness.jpg";

const MATRIX_GLYPHS = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";

const MATRIX_COLUMNS: string[][] = [0, 1, 2].map((col) => {
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    out.push(MATRIX_GLYPHS[(i * 7 + col * 11) % MATRIX_GLYPHS.length]);
  }
  return [...out, ...out];
});

const DIGIT_COLUMN_SEEDS = [
  "47159028361472",
  "83625071948350",
  "90548716230491",
];
const DIGIT_COLUMNS: string[][] = DIGIT_COLUMN_SEEDS.map((s) => {
  const arr = s.split("");
  return [...arr, ...arr];
});

export default async function Home() {
  const user = await getCurrentUser();
  const t = await getDictionary();
  const NAV_ITEMS = [
    { label: t.nav.sanctuary, href: "/", active: true },
    { label: t.nav.apocrypha, href: "/apocrypha" },
    { label: t.nav.requiem, href: "/requiem" },
    { label: t.nav.vigils, href: "/vigils" },
  ];
  return (
    <div className="min-h-screen flex flex-col w-full">
      {/* TopAppBar */}
      <header className="w-full z-50 flex justify-between items-center px-5 md:px-10 py-[10px] bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0 gap-3">
        <Link
          href="/"
          className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 rounded-sm"
        >
          Green Diva
        </Link>
        <nav className="group hidden md:flex items-center gap-11">
          {NAV_ITEMS.map((item) => {
            const className = `font-label text-[12px] tracking-[0.3em] uppercase pb-1 border-b transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4 ${item.active
                ? "text-primary border-secondary/40 group-has-[a:not([data-active]):hover]:text-on-surface-variant group-has-[a:not([data-active]):hover]:border-transparent"
                : "text-on-surface-variant border-transparent hover:text-primary hover:border-secondary/40"
              }`;
            const activeAttr = item.active ? { "data-active": true } : {};
            const ariaCurrent = item.active ? ("page" as const) : undefined;
            if (item.active) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  className={className}
                  aria-current={ariaCurrent}
                  {...activeAttr}
                >
                  {item.label}
                </a>
              );
            }
            return (
              <Link key={item.label} href={item.href} className={className} {...activeAttr}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-7">
          <MobileNav items={NAV_ITEMS} />
          {user ? (
            <UserMenu
              user={{
                name: user.name,
                level: user.level,
                avatarUrl: user.avatarUrl,
                gender: user.gender,
              }}
              isAdmin={user.level >= ADMIN_LEVEL}
            />
          ) : null}
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row max-w-[1440px] w-full mx-auto">
        {/* Left Side: Hero Information */}
        <section className="w-full md:w-[58%] px-5 py-6 md:px-10 md:py-5 flex flex-col gap-6 lg:grid lg:grid-rows-3 relative">
          {/* Sacred Divider — gradient line + center diamond glyph */}
          <div
            aria-hidden
            className="hidden lg:block absolute top-0 right-0 h-full w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent"
          />
          <div
            aria-hidden
            className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 items-center justify-center"
          >
            <span className="absolute w-3 h-3 rounded-full bg-primary/20 blur-md"></span>
            <span className="block w-2 h-2 rotate-45 border border-primary/70 bg-background"></span>
          </div>

          <div className="lg:row-span-2 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch w-full min-h-0">
            <div className="lg:col-span-7 space-y-6 max-w-[52ch]">
              <div className="space-y-3">
                <span className="font-label text-secondary tracking-[0.3em] text-[11px] uppercase block">
                  {t.hero.manifesto}
                </span>
                <h1 className="font-headline text-[40px] sm:text-6xl lg:text-7xl font-light text-primary sacred-glow leading-none tracking-[-0.02em]">
                  {t.hero.oracleTitle}
                </h1>
              </div>
              <div className="space-y-5">
                <div className="space-y-3">
                  <h3 className="font-headline text-2xl md:text-3xl text-secondary italic">
                    {t.hero.introductionHeading}
                  </h3>
                  <p className="font-body text-on-surface-variant text-[14px] font-light leading-[1.7]">
                    {t.hero.introductionBody}
                  </p>
                </div>
                <div className="space-y-3">
                  <h3 className="font-headline text-2xl md:text-3xl text-secondary italic">
                    {t.hero.originHeading}
                  </h3>
                  <p className="font-body text-on-surface-variant text-[14px] font-light leading-[1.7]">
                    {t.hero.originBody}
                  </p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-5 min-h-0 flex items-center justify-center lg:items-stretch">
              <HeroPortrait src={HERO_PORTRAIT} />
            </div>
          </div>

          {/* Oracle loop videos — bottom row of left grid; transparent blend with background */}
          <div className="lg:row-span-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-end">
            {[
              { src: "/videos/oracle-loop.mp4?v=2", label: t.oracleVideos.beginOffering },
              { src: "/videos/oracle-shrine.mp4", label: t.oracleVideos.enterTemple },
            ].map((v, i) => (
              <Link
                key={i}
                href="#"
                aria-label={v.label}
                className="group relative block w-full aspect-[16/9] overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              >
                <SeamlessLoopVideo
                  src={v.src}
                  fadeWindow={0.7}
                  style={{
                    mixBlendMode: "screen",
                    WebkitMaskImage:
                      "radial-gradient(ellipse at center, black 55%, transparent 100%)",
                    maskImage:
                      "radial-gradient(ellipse at center, black 55%, transparent 100%)",
                  }}
                  className="absolute inset-0 w-full h-full object-cover brightness-[0.95] contrast-[1.05] group-hover:brightness-110 touch:brightness-110"
                />
                {/* Hover sweep highlight on the video */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-[5] pointer-events-none opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity duration-500 bg-[linear-gradient(120deg,transparent_30%,rgba(144,222,205,0.18)_50%,transparent_70%)] bg-[length:250%_100%] bg-[position:100%_0] group-hover:[background-position:-50%_0] touch:[background-position:-50%_0] [transition:opacity_0.5s,background-position_1.2s_ease-out]"
                />
                {/* Bottom-right Enter CTA */}
                <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-md border border-primary/40 bg-background/60 backdrop-blur-sm text-primary font-label text-[11px] tracking-[0.25em] uppercase opacity-80 transition-all duration-300 shadow-[0_2px_10px_rgba(0,0,0,0.5)] group-hover:opacity-100 group-hover:border-primary group-hover:bg-background/85 group-hover:text-secondary group-hover:shadow-[0_0_18px_rgba(144,222,205,0.45),0_0_2px_rgba(144,222,205,0.6)_inset] group-hover:-translate-y-0.5 group-hover:tracking-[0.3em] touch:opacity-100 touch:border-primary touch:bg-background/85 touch:text-secondary touch:shadow-[0_0_18px_rgba(144,222,205,0.45),0_0_2px_rgba(144,222,205,0.6)_inset] touch:-translate-y-0.5 touch:tracking-[0.3em]">
                  {/* Corner brackets */}
                  <span aria-hidden="true" className="absolute -top-px -left-px w-2 h-2 border-t border-l border-secondary/0 group-hover:border-secondary touch:border-secondary transition-colors duration-300" />
                  <span aria-hidden="true" className="absolute -top-px -right-px w-2 h-2 border-t border-r border-secondary/0 group-hover:border-secondary touch:border-secondary transition-colors duration-300" />
                  <span aria-hidden="true" className="absolute -bottom-px -left-px w-2 h-2 border-b border-l border-secondary/0 group-hover:border-secondary touch:border-secondary transition-colors duration-300" />
                  <span aria-hidden="true" className="absolute -bottom-px -right-px w-2 h-2 border-b border-r border-secondary/0 group-hover:border-secondary touch:border-secondary transition-colors duration-300" />
                  <span className="relative">{v.label}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1 touch:translate-x-1">
                    <path d="M5 12h14" />
                    <path d="M13 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Right Side: Gallery Modules */}
        <section
          id="chronicle"
          className="w-full md:w-[42%] p-5 md:p-5 gap-4 md:gap-4 bg-surface-container-lowest flex flex-col"
        >
          {/* Module 1: The Written Word */}
          <Link
            href="/written-word"
            className="module-card group relative flex-1 min-h-[144px] md:min-h-[160px] overflow-hidden rounded-xl border border-primary/20 bg-background block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50 group-hover:from-primary/20 touch:from-primary/20 transition-all duration-500"></div>
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity duration-700"></div>
            <div className="scanline-overlay absolute inset-0 z-10"></div>
            <div className="absolute inset-0 flex flex-col justify-center p-5 md:p-6 z-20">
              <span className="material-symbols-outlined block text-secondary text-2xl opacity-70 mb-2 md:mb-4">
                menu_book
              </span>
              <h4 className="font-headline text-3xl md:text-4xl text-secondary font-light leading-[1.05] mb-2 md:mb-3">
                {t.sections.writtenWordTitle}
              </h4>
              <span className="font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase mb-3 md:mb-5 block">
                {t.sections.writtenWordVolume}
              </span>
              <span className="w-fit min-w-[260px] px-8 py-3 text-center bg-primary/5 backdrop-blur-md border border-primary/20 text-[11px] font-label text-primary uppercase tracking-[0.2em] whitespace-nowrap group-hover:bg-primary/20 touch:bg-primary/20 transition-all inline-block">
                {t.sections.openArchives}
              </span>
            </div>
            <div className="hidden sm:flex absolute top-6 right-6 gap-2 z-20">
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse"></div>
            </div>
          </Link>

          {/* Module 2: The Visual Witness */}
          <Link
            href="/visual-witness"
            className="module-card group relative flex-1 min-h-[144px] md:min-h-[160px] overflow-hidden rounded-xl border border-primary/20 bg-background block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          >
            <Image
              alt={t.sections.visualWitnessTitle}
              src={VISUAL_WITNESS}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 42vw"
              className="module-image object-cover brightness-[0.85] group-hover:brightness-[1] touch:brightness-[1] transition-[filter] duration-[2000ms]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-black/40"></div>
            <div className="absolute inset-0 flex flex-col justify-center p-5 md:p-6 z-20">
              <span className="material-symbols-outlined block text-secondary text-2xl opacity-70 mb-2 md:mb-4">
                photo_camera
              </span>
              <h4 className="font-headline text-3xl md:text-4xl text-secondary font-light leading-[1.05] mb-2 md:mb-3">
                {t.sections.visualWitnessTitle}
              </h4>
              <span className="font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase mb-3 md:mb-5 block">
                {t.sections.visualWitnessGallery}
              </span>
              <span className="w-fit min-w-[260px] px-8 py-3 text-center bg-primary/5 backdrop-blur-md border border-primary/20 text-[11px] font-label text-primary uppercase tracking-[0.2em] whitespace-nowrap group-hover:bg-primary/20 touch:bg-primary/20 transition-all inline-block">
                {t.sections.enterFrame}
              </span>
            </div>
            <div className="hidden sm:flex absolute top-6 right-6 gap-2 z-20">
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0s]"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1s]"></div>
            </div>
          </Link>

          {/* Row: Relic & Machine Vision */}
          <div className="grid grid-cols-2 gap-4 md:gap-4 flex-1 min-h-[160px] md:min-h-[175px]">
            {/* Relic Collection */}
            <Link
              href="/relic-collection"
              className="module-card group relative bg-background border border-primary/20 rounded-xl overflow-hidden flex flex-col items-center justify-center gap-4 p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <div className="relic-rings absolute inset-0"></div>
              <div className="containment-field absolute inset-0 opacity-20"></div>
              <div className="relic-radar" aria-hidden="true">
                <span style={{ animationDelay: "0s" }}></span>
                <span style={{ animationDelay: "1.67s" }}></span>
                <span style={{ animationDelay: "3.33s" }}></span>
              </div>
              <div
                aria-hidden="true"
                className="hidden sm:grid absolute top-6 right-6 grid-cols-2 gap-1.5 z-20"
              >
                <span className="w-2 h-2 bg-secondary rounded-full cw-stair" style={{ animationDelay: "0s" }} />
                <span className="w-2 h-2 bg-secondary rounded-full cw-stair" style={{ animationDelay: "-3s" }} />
                <span className="w-2 h-2 bg-secondary rounded-full cw-stair" style={{ animationDelay: "-1s" }} />
                <span className="w-2 h-2 bg-secondary rounded-full cw-stair" style={{ animationDelay: "-2s" }} />
              </div>
              <div className="relative z-20 animate-floating">
                <div className="relative w-16 h-16 flex items-center justify-center border rounded-full animate-relic-border-dim">
                  <div className="absolute w-9 h-9 border animate-reverse-spin"></div>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6 relative animate-relic-text"
                    aria-label="Vault Sigil"
                  >
                    <path d="M12 3l3 3-3 3-3-3z" />
                    <circle cx="12" cy="6" r="0.8" fill="currentColor" stroke="none" />
                    <path d="M12 9v12" />
                    <path d="M9 17h3" />
                    <path d="M12 19h4" />
                    <path d="M9 21h6" />
                  </svg>
                </div>
              </div>
              <span className="block font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase z-20 text-center">
                {t.sections.sacredArtifact}
              </span>
              <div className="z-20 flex flex-col items-center gap-4 w-fit">
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3 w-full"
                >
                  <span className="flex-1 h-px bg-gradient-to-r from-transparent to-primary/60"></span>
                  <span
                    className="block w-2.5 h-2.5 rounded-full shadow-[0_0_9px_rgba(180,210,160,0.45)]"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.55), transparent 45%), linear-gradient(to right, #90decd, #e9c176)",
                    }}
                  ></span>
                  <span className="flex-1 h-px bg-gradient-to-r from-secondary/60 to-transparent"></span>
                </div>
                <h4 className="font-headline text-xl text-secondary relic-text-glow text-center">
                  {t.sections.relicCollectionTitle}
                </h4>
              </div>
            </Link>

            {/* Machine Vision */}
            <Link
              href="/machine-vision"
              className="module-card group relative bg-background border border-primary/20 rounded-xl flex flex-col p-5 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <div className="absolute inset-0 pointer-events-none opacity-20 z-30">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(144,222,205,0.05)_1px,transparent_1px)] bg-[size:100%_8px]"></div>
              </div>
              <div className="scan-line"></div>
              <div className="hidden sm:grid absolute top-6 right-6 grid-cols-2 gap-1.5 z-20">
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0.5s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1.5s]"></div>
              </div>
              <div className="z-20 space-y-2">
                <h4 className="font-headline text-xl text-secondary leading-tight">
                  {t.sections.machineVisionTitle}
                </h4>
                <p className="font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase">
                  {t.sections.syntheticHallucinations}
                </p>
              </div>
              <div className="flex-1 flex flex-col gap-3 z-20">
                {/* Unified machine-vision panel: matrix rain layered over bars + centered all-seeing eye */}
                <div className="relative flex-1 min-h-[4.5rem] w-full rounded-xl overflow-hidden bg-background/80">
                  {/* Background layer: bars */}
                  <div
                    className="absolute inset-0 flex items-end gap-[2px] px-2 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)]"
                    aria-hidden="true"
                  >
                    {[6.2, 11.4, 8.4, 13.8, 7.6, 10.6, 14.8, 9.2, 12.2, 7.0, 11.8, 9.6, 12.8, 7.8].map((dur, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-[1px] animate-neural-bar opacity-60"
                        style={{
                          ['--bar-dur' as string]: `${dur}s`,
                          ['--bar-delay' as string]: `${((i * 0.37) % 4).toFixed(2)}s`,
                        }}
                      />
                    ))}
                  </div>
                  {/* Overlay layer: matrix rain across full width */}
                  <div
                    aria-hidden="true"
                    className="hidden sm:grid absolute inset-0 grid-cols-6 gap-x-px font-mono text-[8px] leading-[1.05] animate-relic-text-80 opacity-60 [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)]"
                  >
                    {[...MATRIX_COLUMNS, ...DIGIT_COLUMNS].map((col, ci) => (
                      <div
                        key={ci}
                        className="flex flex-col items-center animate-matrix-rain"
                        style={{
                          animationDelay: `${(ci * 0.45).toFixed(2)}s`,
                          animationDuration: `${[5, 8, 10, 6, 9, 11, 7, 12, 8, 10, 6, 9][ci]}s`,
                        }}
                      >
                        {col.map((c, i) => (
                          <span key={i}>{c}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="scanline-overlay absolute inset-0 z-10 pointer-events-none"></div>
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-grid text-[40px] leading-none pointer-events-none drop-shadow-[0_0_8px_rgba(144,222,205,0.55)] z-20"
                  >
                    <span
                      className="material-symbols-outlined col-start-1 row-start-1 text-background"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      visibility
                    </span>
                    <span className="material-symbols-outlined col-start-1 row-start-1 animate-relic-text-70">
                      visibility
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-primary animate-ping [animation-duration:1.6s]"></div>
                  <span className="font-label text-[11px] text-primary/70 uppercase tracking-[0.2em]">
                    {t.sections.neuralSync}<span className="animate-sync-ellipsis" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      </main>

    </div>
  );
}
