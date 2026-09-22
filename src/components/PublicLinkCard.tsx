"use client";

import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Card } from "@/components/ui";

/**
 * Carte lien public (page praticien ou cabinet) : visiter + copier.
 * Le lien est construit depuis l'origine courante (aucun domaine inliné).
 */
export default function PublicLinkCard({
  path,
  title,
  description,
  enabled = true,
  disabledHint,
}: {
  path: string;
  title: string;
  description: string;
  enabled?: boolean;
  disabledHint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  // Nettoie le minuteur de feedback à l'unmount.
  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card title={title} description={description}>
      {enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-sm underline"
          >
            {path}
          </a>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? t("profile.copied") : t("profile.copy")}
            </Button>
            <Button size="sm" onClick={() => window.open(path, "_blank", "noopener")}>
              {t("profile.visit")}
            </Button>
          </span>
          <span aria-live="polite" className="sr-only">
            {copied ? t("profile.copied") : ""}
          </span>
        </div>
      ) : (
        <p className="text-sm text-mist">{disabledHint}</p>
      )}
    </Card>
  );
}
