import { cookies } from "next/headers";
import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import "./globals.css";
import {
  COOKIE_MODE,
  COOKIE_PALETTE,
  parseMode,
  parsePalette,
} from "@/lib/theme";

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
  // Thème lu côté serveur (cookies) : pas de flash au chargement.
  // Les pages publiques surchargent via leur propre wrapper (ambiance).
  const store = await cookies();
  const palette = parsePalette(store.get(COOKIE_PALETTE)?.value);
  const mode = parseMode(store.get(COOKIE_MODE)?.value);
  return (
    <html
      lang="fr"
      data-palette={palette}
      data-mode={mode}
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">{children}</body>
    </html>
  );
}
