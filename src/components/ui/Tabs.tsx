"use client";

import { useEffect, useState } from "react";

/**
 * Onglets génériques (utilisés par Profil et Paramètres).
 * Avec `param`, l'onglet actif est reflété dans l'URL (?param=onglet) via
 * `replaceState` (sans rechargement) : il survit au reload et aux partages
 * de lien. Le serveur initialise depuis ce même paramètre.
 */
export default function Tabs<T extends string>({
  tabs,
  initial,
  children,
  param,
}: {
  tabs: { key: T; label: string }[];
  initial: T;
  children: Record<T, React.ReactNode>;
  param?: string;
}) {
  const [tab, setTab] = useState<T>(initial);

  function select(key: T) {
    setTab(key);
    if (param) {
      const url = new URL(window.location.href);
      url.searchParams.set(param, key);
      window.history.replaceState(null, "", url);
    }
  }

  // Boutons précédent/suivant du navigateur : resynchronise l'état sur l'URL.
  useEffect(() => {
    if (!param) return;
    const onPop = () => {
      const v = new URL(window.location.href).searchParams.get(param);
      if (v && (tabs as { key: string }[]).some((t) => t.key === v)) setTab(v as T);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [param, tabs]);

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => select(key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-brand text-ink"
                : "border-transparent text-mist hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {children[tab]}
    </div>
  );
}
