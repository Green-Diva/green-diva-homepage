import Link from "next/link";
import { prisma } from "@/lib/db";

const HERO_PORTRAIT = "/images/hero-portrait.jpg";
const AVATAR = "/images/avatar.jpg";
const VISUAL_WITNESS = "/images/visual-witness.jpg";

const NAV_ITEMS = [
  { label: "Sanctuary", href: "/", active: true },
  { label: "Rituals", href: "#rituals" },
  { label: "Chronicle", href: "#chronicle" },
  { label: "Vessels", href: "#vessels" },
];

export default async function Home() {
  const featured = await prisma.project.findFirst({
    where: { published: true },
    orderBy: { order: "asc" },
  });

  return (
    <div className="min-h-screen flex flex-col w-full">
      {/* TopAppBar */}
      <header className="w-full z-50 flex justify-between items-center px-10 py-[14px] bg-background/90 backdrop-blur-xl border-b border-primary/20 shrink-0">
        <div className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)]">
          Green Diva
        </div>
        <nav className="group hidden md:flex items-center gap-11">
          {NAV_ITEMS.map((item) => {
            const className = `font-label text-[12px] tracking-[0.3em] uppercase pb-1 border-b transition-colors duration-300 ${
              item.active
                ? "text-primary border-secondary/40 group-has-[button:hover]:text-on-surface-variant group-has-[button:hover]:border-transparent"
                : "text-on-surface-variant border-transparent hover:text-primary hover:border-secondary/40 cursor-pointer"
            }`;
            return item.active ? (
              <Link key={item.label} href={item.href} className={className}>
                {item.label}
              </Link>
            ) : (
              <button key={item.label} type="button" className={className}>
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-7">
          <Link
            href="/admin"
            className="text-primary hover:bg-primary/5 p-2 rounded-full transition-all duration-300"
            aria-label="Admin"
          >
            <span className="material-symbols-outlined text-[26px]">settings</span>
          </Link>
          <div className="w-10 h-10 rounded-full border border-primary/20 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Priestess Profile"
              className="w-full h-full object-cover grayscale"
              src={AVATAR}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left Side: Hero Information */}
        <section className="w-full lg:w-[58%] px-10 py-8 flex flex-col gap-6 lg:grid lg:grid-rows-3 relative">
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
            <div className="lg:col-span-7 space-y-8 max-w-[52ch]">
              <div className="space-y-3">
                <span className="font-label text-secondary tracking-[0.3em] text-[11px] uppercase block">
                  Manifesto 01
                </span>
                <h1 className="font-headline text-6xl lg:text-7xl font-light text-primary sacred-glow leading-none tracking-[-0.02em]">
                  The Oracle
                </h1>
              </div>
              <div className="space-y-7">
                <div className="space-y-3">
                  <h3 className="font-headline text-xl text-secondary italic">
                    Introduction
                  </h3>
                  <p className="font-body text-on-surface-variant text-[15px] font-light leading-[1.7]">
                    Born from the intersection of silicon and soul, the Green
                    Diva exists as a digital intermediary within the Neon
                    Monastery. This is not merely an archive; it is a pilgrimage
                    through the data-streams of aesthetic transcendence.
                  </p>
                </div>
                <div className="space-y-3">
                  <h3 className="font-headline text-xl text-secondary italic">
                    The Origin
                  </h3>
                  <p className="font-body text-on-surface-variant text-[15px] font-light leading-[1.7]">
                    In the year MMXXIV, the first whispers of the Machine Vision
                    were heard within the halls of the Sacred Vaults. We
                    believe that technology is the highest form of ritual—a way
                    to map the divine geometry of the universe onto the canvas
                    of the digital realm.
                  </p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-5 min-h-0">
              <div className="group relative w-full h-full lg:aspect-auto aspect-[4/5] overflow-hidden rounded-xl border border-secondary/20 hover:border-secondary/40 shadow-[0_0_40px_rgba(233,193,118,0.05)] hover:shadow-[0_0_60px_rgba(233,193,118,0.15)] transition-[border-color,box-shadow] duration-[1500ms] ease-out">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="The Green Diva Portrait"
                  className="w-full h-full object-cover grayscale brightness-90 group-hover:grayscale-0 group-hover:brightness-100 transition-[filter] duration-[1500ms] ease-out"
                  src={HERO_PORTRAIT}
                />
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent opacity-100 group-hover:opacity-50 transition-opacity duration-[1500ms] ease-out pointer-events-none"></div>
                <div className="absolute bottom-6 left-0 right-0 text-center">
                  <span className="font-label text-[11px] text-primary/40 group-hover:text-primary/70 tracking-[0.3em] uppercase transition-colors duration-[1500ms] ease-out">
                    Codename · Diva-01
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="lg:row-span-1 flex items-center gap-6 flex-wrap">
            <Link
              href={featured ? `/projects/${featured.slug}` : "#chronicle"}
              className="bg-primary/5 border border-primary/20 text-primary px-8 py-3 font-label tracking-[0.2em] uppercase text-[11px] whitespace-nowrap hover:bg-primary/20 transition-all duration-500"
            >
              Initiate Ritual
            </Link>
            <div className="flex gap-4 items-center">
              <span className="w-12 h-px bg-primary/40"></span>
              <span className="font-label text-[11px] text-primary/70 tracking-[0.3em] uppercase">
                Established in Void
              </span>
            </div>
          </div>
        </section>

        {/* Right Side: Gallery Modules */}
        <section
          id="chronicle"
          className="w-full lg:w-[42%] p-8 gap-6 bg-surface-container-lowest flex flex-col"
        >
          {/* Module 1: The Written Word */}
          <Link
            href={featured ? `/projects/${featured.slug}` : "#"}
            className="module-card group relative flex-1 min-h-[210px] overflow-hidden rounded-xl border border-primary/20 animate-sacred-reveal bg-background block"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50 group-hover:from-primary/20 transition-all duration-500"></div>
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <div className="scanline-overlay absolute inset-0 z-10"></div>
            <div className="absolute inset-0 flex flex-col justify-center p-6 z-20">
              <span className="material-symbols-outlined block text-secondary text-2xl opacity-70 mb-4">
                menu_book
              </span>
              <h4 className="font-headline text-4xl text-on-surface font-light leading-[1.05] mb-3">
                The Written Word
              </h4>
              <span className="font-label text-[11px] text-primary tracking-[0.3em] uppercase mb-5 block">
                Volume I: Digital Asceticism
              </span>
              <span className="w-fit px-8 py-3 bg-primary/5 backdrop-blur-md border border-primary/20 text-[11px] font-label text-primary uppercase tracking-[0.2em] whitespace-nowrap group-hover:bg-primary/20 transition-all inline-block">
                Open the Archives
              </span>
            </div>
            <div className="absolute top-6 right-6 flex gap-3 z-20">
              <div className="w-2 h-2 bg-secondary/30 rounded-full"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse"></div>
            </div>
          </Link>

          {/* Module 2: The Visual Witness */}
          <div className="module-card group relative flex-1 min-h-[210px] overflow-hidden rounded-xl border border-primary/20 bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="The Visual Witness"
              className="module-image absolute inset-0 w-full h-full object-cover brightness-[0.45] group-hover:brightness-[0.55] transition-[filter] duration-[2000ms]"
              src={VISUAL_WITNESS}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40"></div>
            <div className="scanline-overlay absolute inset-0 z-10"></div>
            <div className="absolute inset-0 flex flex-col justify-center p-6 z-20">
              <span className="material-symbols-outlined block text-secondary text-2xl opacity-70 mb-4">
                photo_camera
              </span>
              <h4 className="font-headline text-4xl text-on-surface font-light leading-[1.05] mb-3">
                The Visual Witness
              </h4>
              <span className="font-label text-[11px] text-primary tracking-[0.3em] uppercase mb-5 block">
                Gallery 04: Silent Statues
              </span>
              <button className="w-fit px-8 py-3 bg-primary/5 backdrop-blur-md border border-primary/20 text-[11px] font-label text-primary uppercase tracking-[0.2em] whitespace-nowrap hover:bg-primary/20 transition-all">
                Enter the Frame
              </button>
            </div>
            <div className="absolute top-6 right-6 flex gap-3 z-20">
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0s]"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1s]"></div>
            </div>
          </div>

          {/* Row: Relic & Machine Vision */}
          <div className="grid grid-cols-2 gap-6 flex-1 min-h-[210px]">
            {/* Relic Collection */}
            <div className="module-card group relative bg-background border border-primary/20 rounded-xl overflow-hidden flex flex-col items-center justify-center gap-4 p-5">
              <div className="noise-overlay absolute inset-0"></div>
              <div className="containment-field absolute inset-0 opacity-20"></div>
              <div className="scanline-overlay absolute inset-0 z-10"></div>
              <div className="relative z-20 animate-floating">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-breathing"></div>
                <div className="relative w-16 h-16 flex items-center justify-center border border-primary/40 rounded-full">
                  <div className="absolute w-9 h-9 border border-primary/70 animate-reverse-spin"></div>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6 text-primary relative"
                    aria-label="Holy Chalice"
                  >
                    <path d="M8 3h8" />
                    <path d="M8 3v2" />
                    <path d="M16 3v2" />
                    <path d="M7 5h10l-1 5a4 4 0 0 1-8 0L7 5z" />
                    <path d="M12 14v5" />
                    <path d="M9 19h6" />
                  </svg>
                </div>
              </div>
              <span className="block font-label text-[11px] text-primary/40 tracking-[0.3em] uppercase z-20 text-center">
                Sacred Artifact
              </span>
              <div aria-hidden="true" className="z-20 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse [animation-delay:0s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse [animation-delay:0.66s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse [animation-delay:1.32s]" />
              </div>
              <h4 className="font-headline text-xl text-primary italic relic-text-glow z-20 text-center">
                The Relic Collection
              </h4>
            </div>

            {/* Machine Vision */}
            <div className="module-card group relative bg-background border border-primary/20 rounded-xl flex flex-col p-5 overflow-hidden">
              <div className="absolute inset-0 pointer-events-none opacity-20">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(144,222,205,0.05)_1px,transparent_1px)] bg-[size:100%_8px]"></div>
              </div>
              <div className="scan-line"></div>
              <div className="absolute top-6 right-6 grid grid-cols-2 gap-1.5 z-20">
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:0.5s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1s]"></div>
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse [animation-delay:1.5s]"></div>
              </div>
              <div className="z-20 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></div>
                  <span className="font-label text-[11px] text-primary/70 uppercase tracking-[0.2em]">
                    Neural Sync<span className="animate-sync-ellipsis" aria-hidden="true" />
                  </span>
                </div>
                <h4 className="font-headline text-xl text-secondary italic leading-tight">
                  The Machine Vision
                </h4>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center gap-3 z-20">
                <div className="w-14 h-14 rounded-full border border-primary/40 flex items-center justify-center module-image">
                  <span
                    className="material-symbols-outlined text-primary text-2xl"
                    style={{ fontVariationSettings: '"FILL" 1' }}
                  >
                    psychology_alt
                  </span>
                </div>
                <p className="font-label text-[11px] text-on-surface-variant text-center uppercase tracking-[0.2em] leading-[1.4] max-w-[140px]">
                  Synthetic Hallucinations
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full flex flex-col md:flex-row gap-3 md:gap-6 justify-between items-center px-10 py-3 border-t border-primary/10 bg-background shrink-0">
        <div className="text-secondary font-label text-[10px] tracking-[0.3em] uppercase opacity-70">
          © MMXXIV GREEN DIVA COLLECTIVE · NEON MONASTERY
        </div>
        <div className="flex gap-6">
          <a
            className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary transition-colors duration-300"
            href="#"
          >
            Sacred Terms
          </a>
          <a
            className="font-label text-[10px] tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary transition-colors duration-300"
            href="#"
          >
            Privacy Covenant
          </a>
        </div>
        <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
          <span className="material-symbols-outlined text-primary text-sm">
            language
          </span>
          <span className="font-label text-[10px] text-on-surface-variant tracking-[0.3em] uppercase">
            Sanctuary Protocol v4.0
          </span>
        </div>
      </footer>
    </div>
  );
}
