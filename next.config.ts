import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome (.next/standalone) uniquement pour Docker : on l'active via
  // BUILD_TARGET=docker. Tout autre build reste inchangé.
  ...(process.env.BUILD_TARGET === "docker" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
  // Ce dossier est la racine du projet (plusieurs lockfiles existent au-dessus).
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
