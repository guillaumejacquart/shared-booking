"use client";

import { useState } from "react";

/** Onglets génériques (utilisés par Profil et Paramètres). */
export default function Tabs<T extends string>({
  tabs,
  initial,
  children,
}: {
  tabs: { key: T; label: string }[];
  initial: T;
  children: Record<T, React.ReactNode>;
}) {
  const [tab, setTab] = useState<T>(initial);
  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
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
