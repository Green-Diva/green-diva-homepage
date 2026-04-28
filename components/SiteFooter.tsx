import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getDictionary } from "@/lib/i18n/server";

export default async function SiteFooter() {
  const t = await getDictionary();
  return (
    <footer className="w-full flex flex-col md:grid md:grid-cols-3 gap-3 md:gap-6 items-center px-5 md:px-10 py-2 border-t border-primary/10 bg-background shrink-0">
      <div className="text-secondary font-label text-[11px] md:text-[10px] tracking-[0.2em] md:tracking-[0.3em] uppercase opacity-70 text-center md:text-left md:justify-self-start">
        {t.footer.copyright}
      </div>
      <div className="flex gap-4 md:gap-6 md:justify-self-center">
        <Link
          className="font-label text-[11px] md:text-[10px] tracking-[0.2em] md:tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          href="/sacred-terms"
        >
          {t.footer.sacredTerms}
        </Link>
        <Link
          className="font-label text-[11px] md:text-[10px] tracking-[0.2em] md:tracking-[0.3em] uppercase text-on-surface-variant hover:text-primary transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          href="/privacy-covenant"
        >
          {t.footer.privacyCovenant}
        </Link>
      </div>
      <div className="md:justify-self-end">
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
