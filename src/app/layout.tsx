import Script from "next/script";
import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import "./globals.css";
import { DEFAULT_MODE, DEFAULT_PALETTE } from "@/lib/theme";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Work_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Réservation de séances",
  description: "Réservez votre séance bien-être en ligne, sans compte.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Thème par défaut (pages hors cabinet : login, onboarding…).
  // Le dashboard et les pages publiques appliquent l'ambiance du cabinet
  // via leur propre wrapper (thème unique).
  return (
    <html
      lang="fr"
      data-palette={DEFAULT_PALETTE}
      data-mode={DEFAULT_MODE}
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">
        {children}
        {/* Umami analytics (stats.guillaumejacquart.com). Skipped in dev. */}
        {process.env.NODE_ENV !== "development" && (
          <Script
            src="https://stats.guillaumejacquart.com/script.js"
            data-website-id="ad8fcc2f-4830-436f-82e0-319f14727adb"
          />
        )}
      </body>
    </html>
  );
}
