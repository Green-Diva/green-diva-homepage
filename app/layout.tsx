import type { Metadata } from "next";
import { Noto_Serif, Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary, getLocale } from "@/lib/i18n/server";

const notoSerif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  style: ["normal", "italic"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["200", "400", "600"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "500", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: {
      default: dict.metadata.title,
      template: dict.metadata.titleTemplate,
    },
    description: dict.metadata.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dict = await getDictionary();
  return (
    <html
      lang={locale}
      className={`dark ${notoSerif.variable} ${manrope.variable} ${spaceGrotesk.variable}`}
    >
      <body className="font-body selection:bg-primary/30 selection:text-primary min-h-screen flex flex-col relative">
        {/* Global atmospheric backdrop */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          {/* faint grid lattice */}
          <div
            className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(rgba(144,222,205,1)_1px,transparent_1px),linear-gradient(90deg,rgba(144,222,205,1)_1px,transparent_1px)]"
            style={{ backgroundSize: "56px 56px" }}
          />
          {/* radial vignette */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(0,0,0,0.55)_70%,rgba(0,0,0,0.85)_100%)]" />
          {/* drifting nebula */}
          <div className="absolute -top-40 left-1/4 w-[576px] h-[576px] rounded-full bg-primary/[0.04] blur-[126px]" />
          <div className="absolute bottom-0 -right-40 w-[468px] h-[468px] rounded-full bg-secondary/[0.035] blur-[108px]" />
          {/* scanline cap */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        </div>
        <I18nProvider locale={locale} dict={dict}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
