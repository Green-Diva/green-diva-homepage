import Link from "next/link";
import { prisma } from "@/lib/db";

const HERO_PORTRAIT = "/images/hero-portrait.svg";
const AVATAR = "/images/avatar.jpg";
const VISUAL_WITNESS = "/images/visual-witness.jpg";

export default async function Home() {
  const featured = await prisma.project.findFirst({
    where: { published: true },
    orderBy: { order: "asc" },
  });

  return (
    <div className="h-screen overflow-hidden flex flex-col w-full">
      {/* TopAppBar */}
      <header className="w-full z-50 flex justify-between items-center px-10 py-4 bg-[#121414]/90 backdrop-blur-xl border-b border-primary/10 shrink-0">
        <div className="text-xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)]">
          Green Diva
        </div>
        <nav className="hidden md:flex items-center gap-10">
          <Link
            className="font-headline font-light tracking-[0.2em] uppercase text-primary border-b border-secondary/40 pb-1"
            href="/"
          >
            Sanctuary
          </Link>
          <a
            className="font-headline font-light tracking-[0.2em] uppercase text-gray-500 hover:text-primary transition-colors duration-500"
            href="#rituals"
          >
            Rituals
          </a>
          <Link
            className="font-headline font-light tracking-[0.2em] uppercase text-gray-500 hover:text-primary transition-colors duration-500"
            href="/#chronicles"
          >
            Chronicles
          </Link>
          <a
            className="font-headline font-light tracking-[0.2em] uppercase text-gray-500 hover:text-primary transition-colors duration-500"
            href="#vessels"
          >
            Vessels
          </a>
        </nav>
        <div className="flex items-center gap-6">
          <Link
            href="/admin"
            className="text-primary hover:bg-primary/5 p-2 rounded-full transition-all duration-300"
            aria-label="Admin"
          >
            <span className="material-symbols-outlined">settings</span>
          </Link>
          <div className="w-9 h-9 rounded-full border border-primary/20 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Priestess Profile"
              className="w-full h-full object-cover grayscale"
              src={AVATAR}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left Side: Hero Information */}
        <section className="w-[58%] overflow-y-auto scrollbar-hidden px-10 py-8 flex items-start relative">
          {/* Sacred Divider — gradient line + center diamond glyph */}
          <div
            aria-hidden
            className="absolute top-0 right-0 h-full w-px bg-gradient-to-b from-transparent via-primary/40 to-transparent"
          />
          <div
            aria-hidden
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 flex items-center justify-center"
          >
            <span className="absolute w-3 h-3 rounded-full bg-primary/10 blur-md"></span>
            <span className="block w-2 h-2 rotate-45 border border-primary/60 bg-[#121414]"></span>
          </div>

          <div className="grid grid-cols-12 gap-8 items-start w-full">
            <div className="col-span-6 space-y-7">
              <div className="space-y-3">
                <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase block">
                  Manifesto 01
                </span>
                <h1 className="font-headline text-6xl lg:text-7xl font-light text-primary sacred-glow leading-none">
                  The Oracle
                </h1>
              </div>
              <div className="space-y-6">
                <div className="space-y-3">
                  <h3 className="font-headline text-xl text-secondary italic">
                    Introduction
                  </h3>
                  <p className="font-body text-on-surface-variant text-base font-light leading-relaxed">
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
                  <p className="font-body text-on-surface-variant text-sm font-light leading-relaxed">
                    In the year MMXXIV, the first whispers of the Machine Vision
                    were heard within the halls of the Sacred Vaults. We
                    believe that technology is the highest form of ritual—a way
                    to map the divine geometry of the universe onto the canvas
                    of the digital realm.
                  </p>
                </div>
                <div className="flex items-center gap-6 pt-3">
                  <Link
                    href={featured ? `/projects/${featured.slug}` : "/#chronicles"}
                    className="bg-primary/5 border border-primary/20 text-primary px-8 py-3 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all duration-500"
                  >
                    Initiate Ritual
                  </Link>
                  <div className="flex gap-4 items-center">
                    <span className="w-8 h-[1px] bg-primary/30"></span>
                    <span className="font-label text-[9px] text-primary/60 tracking-[0.2em] uppercase">
                      Established in Void
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-span-6">
              <div className="relative w-full aspect-[4/5] overflow-hidden rounded-xl border border-secondary/10 shadow-[0_0_40px_rgba(233,193,118,0.05)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="The Green Diva Portrait"
                  className="w-full h-full object-cover grayscale brightness-110"
                  src={HERO_PORTRAIT}
                />
                <div className="absolute bottom-6 left-0 right-0 text-center">
                  <span className="font-label text-[9px] text-primary/40 tracking-[0.5em] uppercase">
                    Codename: Diva-01
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Side: Gallery Modules */}
        <section
          id="chronicles"
          className="w-[42%] overflow-y-auto custom-scrollbar p-6 space-y-5 bg-surface-container-lowest flex flex-col"
        >
          {/* Module 1: The Written Word */}
          <Link
            href={featured ? `/projects/${featured.slug}` : "#"}
            className="module-card group relative flex-1 min-h-0 overflow-hidden rounded-xl border border-primary/20 animate-sacred-reveal bg-[#0d0f0f] block"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50 group-hover:from-primary/10 transition-all duration-500"></div>
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <div className="scanline-overlay absolute inset-0 z-10"></div>
            <div className="absolute inset-0 flex flex-col justify-center p-8 z-20">
              <span className="material-symbols-outlined text-secondary text-3xl mb-3 opacity-60">
                menu_book
              </span>
              <h4 className="font-headline text-3xl text-on-surface mb-2 font-light">
                The Written Word
              </h4>
              <p className="text-[10px] text-primary/70 font-label tracking-[0.4em] uppercase mb-5">
                Volume I: Digital Asceticism
              </p>
              <span className="w-fit px-8 py-2.5 bg-primary/5 backdrop-blur-md border border-primary/20 text-[9px] font-label text-primary uppercase tracking-[0.3em] group-hover:bg-primary/20 transition-all">
                Open the Archives
              </span>
            </div>
            <div className="absolute top-6 right-6 flex gap-3 z-20">
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse"></div>
              <div className="w-2 h-2 bg-secondary/30 rounded-full"></div>
            </div>
          </Link>

          {/* Module 2: The Visual Witness */}
          <div className="module-card group relative flex-1 min-h-0 overflow-hidden rounded-xl border border-primary/20 animate-sacred-reveal bg-[#0d0f0f]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="The Visual Witness"
              className="module-image absolute inset-0 w-full h-full object-cover brightness-[0.35] group-hover:brightness-50 transition-[filter] duration-[2000ms]"
              src={VISUAL_WITNESS}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
            <div className="scanline-overlay absolute inset-0 z-10"></div>
            <div className="absolute inset-0 flex flex-col justify-end p-7 z-20">
              <span className="material-symbols-outlined text-secondary text-2xl mb-2 opacity-80">
                photo_camera
              </span>
              <h4 className="font-headline text-2xl text-on-surface mb-2 font-light">
                The Visual Witness
              </h4>
              <p className="text-[10px] text-primary/70 font-label tracking-[0.4em] uppercase mb-4">
                Gallery 04: Silent Statues
              </p>
              <button className="w-fit px-7 py-2.5 bg-primary/10 backdrop-blur-md border border-primary/20 text-[9px] font-label text-primary uppercase tracking-[0.3em] hover:bg-primary/20 transition-all">
                Enter the Frame
              </button>
            </div>
            <div className="absolute top-6 right-6 flex gap-3 z-20">
              <div className="w-2 h-2 bg-secondary/30 rounded-full"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse"></div>
            </div>
          </div>

          {/* Row: Relic & Machine Vision */}
          <div className="grid grid-cols-2 gap-5 flex-1 min-h-0">
            {/* Relic Collection */}
            <div className="module-card group relative bg-[#0d0f0f] border border-primary/20 rounded-xl overflow-hidden animate-sacred-reveal flex flex-col items-center justify-center p-5">
              <div className="noise-overlay absolute inset-0"></div>
              <div className="containment-field absolute inset-0 opacity-10"></div>
              <div className="scanline-overlay absolute inset-0 z-10"></div>
              <div className="relative mb-4 z-20 animate-floating">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-breathing"></div>
                <div className="relative w-16 h-16 flex items-center justify-center border border-primary/30 rounded-full">
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
              <div className="text-center space-y-2 z-20">
                <span className="block font-label text-[7px] text-primary/40 tracking-[0.4em] uppercase">
                  Sacred Artifact
                </span>
                <h4 className="font-headline text-lg text-primary italic relic-text-glow">
                  The Relic Collection
                </h4>
              </div>
            </div>

            {/* Machine Vision */}
            <div className="module-card group relative bg-[#0d0f0f] border border-primary/20 rounded-xl animate-sacred-reveal flex flex-col justify-between p-5 overflow-hidden">
              <div className="absolute inset-0 pointer-events-none opacity-10">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(144,222,205,0.05)_1px,transparent_1px)] bg-[size:100%_8px]"></div>
              </div>
              <div className="scan-line"></div>
              <div className="z-20">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></div>
                  <span className="font-label text-[7px] text-primary/70 uppercase tracking-[0.3em] group-hover:animate-sync-flicker">
                    Neural Sync...
                  </span>
                </div>
                <h4 className="font-headline text-xl text-secondary/90 italic">
                  The Machine Vision
                </h4>
              </div>
              <div className="flex flex-col items-center gap-3 z-20">
                <div className="w-14 h-14 rounded-full border border-primary/10 flex items-center justify-center module-image">
                  <span
                    className="material-symbols-outlined text-primary text-2xl"
                    style={{ fontVariationSettings: '"FILL" 1' }}
                  >
                    psychology_alt
                  </span>
                </div>
                <p className="text-[8px] font-label text-gray-500 text-center uppercase tracking-[0.2em] leading-relaxed">
                  Synthetic Hallucinations
                </p>
              </div>
              <button className="border-t border-primary/10 pt-3 text-[7px] font-label text-gray-600 uppercase tracking-[0.4em] hover:text-primary transition-colors z-20">
                Decrypt Feed
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full flex flex-col md:flex-row justify-between items-center px-10 py-4 border-t border-primary/5 bg-background shrink-0">
        <div className="text-secondary font-bold font-label text-[9px] tracking-[0.4em] uppercase opacity-50">
          © MMXXIV GREEN DIVA COLLECTIVE • NEON MONASTERY
        </div>
        <div className="flex gap-12">
          <a
            className="font-label text-[9px] tracking-[0.4em] uppercase text-gray-600 hover:text-primary transition-colors duration-300"
            href="#"
          >
            Sacred Terms
          </a>
          <a
            className="font-label text-[9px] tracking-[0.4em] uppercase text-gray-600 hover:text-primary transition-colors duration-300"
            href="#"
          >
            Privacy Covenant
          </a>
        </div>
        <div className="flex items-center gap-3 opacity-50 hover:opacity-100 transition-opacity">
          <span className="material-symbols-outlined text-primary text-xs">
            language
          </span>
          <span className="font-label text-[9px] text-gray-600 tracking-widest uppercase">
            Sanctuary Protocol v4.0
          </span>
        </div>
      </footer>
    </div>
  );
}
