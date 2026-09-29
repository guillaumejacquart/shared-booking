"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toKey } from "@/lib/calendar";

export interface SlotDto {
  startAt: string;
  endAt: string;
}

/**
 * Charge les créneaux disponibles d'un praticien pour un type de séance.
 * Un seul appel couvrant `days` jours : jours disponibles + créneaux par jour.
 *
 * Remise à zéro via le motif « ajustement d'état pendant le rendu »
 * (clé mémorisée) : l'effet ne fait que s'abonner au fetch, sans setState
 * synchrone.
 */
export function useAvailableSlots(slug: string, sessionTypeId: string, days = 56) {
  const [allSlots, setAllSlots] = useState<SlotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const key = `${slug}|${sessionTypeId}|${days}|${nonce}`;
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setAllSlots([]);
    setLoading(Boolean(sessionTypeId));
  }

  const reload = useCallback(() => setNonce((prev) => prev + 1), []);
  const reset = useCallback(() => setNonce((prev) => prev + 1), []);

  useEffect(() => {
    if (!sessionTypeId) return;
    let cancelled = false;
    const today = toKey(new Date());
    fetch(`/api/p/${slug}/slots?sessionTypeId=${sessionTypeId}&from=${today}&days=${days}`)
      .then((res) => (res.ok ? res.json() : { slots: [] }))
      .then((data) => {
        if (!cancelled) setAllSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setAllSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, sessionTypeId, days, nonce]);

  const byDay = useMemo(() => {
    const map = new Map<string, SlotDto[]>();
    for (const slot of allSlots) {
      const key = toKey(new Date(slot.startAt));
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [allSlots]);

  const availableDays = useMemo(() => new Set(byDay.keys()), [byDay]);

  // Sans type de séance : dérive vide (pas d'appel réseau).
  if (!sessionTypeId) {
    return { allSlots: [] as SlotDto[], byDay: new Map<string, SlotDto[]>(), availableDays: new Set<string>(), loading: false, reload, reset };
  }

  return { allSlots, byDay, availableDays, loading, reload, reset };
}
