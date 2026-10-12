/** Tri canonique des salles : `sortOrder` puis nom puis id. */
export function sortRooms<T extends { room: { sortOrder: number; name: string; id: string } }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (left, right) =>
      left.room.sortOrder - right.room.sortOrder ||
      left.room.name.localeCompare(right.room.name) ||
      (left.room.id < right.room.id ? -1 : left.room.id > right.room.id ? 1 : 0),
  );
}

/**
 * Salles attribuables au praticien, par ordre de préférence.
 * `allowAll` = tous les praticiens ; sinon seuls les praticiens listés
 * (liste vide = personne).
 */
export function allowedRoomIdsFor<
  T extends {
    room: { sortOrder: number; name: string; id: string; allowAll?: boolean };
    practitionerIds: string[];
  },
>(practitionerId: string, rooms: T[]): string[] {
  // `allowAll` absent (appelant legacy) : repli sur l'ancienne convention
  // « allowlist vide = tous » pour ne rien casser en silence.
  return sortRooms(rooms.filter(
    (entry) =>
      (entry.room.allowAll ?? entry.practitionerIds.length === 0) ||
      entry.practitionerIds.includes(practitionerId),
  )).map((entry) => entry.room.id);
}
