"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function select(key: T) {
    setTab(key);
    if (param) {
      const url = new URL(window.location.href);
      url.searchParams.set(param, key);
      window.history.replaceState(null, "", url);
    }
  }

  // Clé stable : évite de resouscrire à chaque render (tabs est souvent un littéral).
  const keys = tabs.map((t) => t.key).join("|");

  // Boutons précédent/suivant du navigateur : resynchronise l'état sur l'URL.
  useEffect(() => {
    if (!param) return;
    const onPop = () => {
      const v = new URL(window.location.href).searchParams.get(param);
      if (v && keys.split("|").includes(v)) setTab(v as T);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [param, keys]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.key === tab);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    if (next) {
      select(next.key);
      // Déplace le focus sur l'onglet activé.
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)
          ?.focus();
      });
    }
  }

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Onglets"
        onKeyDown={onKeyDown}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              data-tab={key}
              id={`${baseId}-tab-${key}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(key)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand text-ink"
                  : "border-transparent text-mist hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${tab}`}
        aria-labelledby={`${baseId}-tab-${tab}`}
      >
        {children[tab]}
      </div>
    </div>
  );
}
