import type { Metadata } from "next";
import { Noto_Serif, Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

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

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "GREEN DIVA";

export const metadata: Metadata = {
  title: {
    default: `${siteName} | The Neon Monastery`,
    template: `%s · ${siteName}`,
  },
  description:
    "Green Diva — a digital intermediary within the Neon Monastery. A pilgrimage through the data-streams of aesthetic transcendence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${notoSerif.variable} ${manrope.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body className="font-body selection:bg-primary/30 selection:text-primary min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
