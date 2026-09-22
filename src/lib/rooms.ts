/** Tri canonique des salles : `sortOrder` puis nom puis id. */
export function sortRooms<T extends { room: { sortOrder: number; name: string; id: string } }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.room.sortOrder - b.room.sortOrder ||
      a.room.name.localeCompare(b.room.name) ||
      (a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0),
  );
}

/**
 * Salles attribuables au praticien, par ordre de préférence.
 * Allowlist vide = toutes les salles.
 */
export function allowedRoomIdsFor<
  T extends { room: { sortOrder: number; name: string; id: string }; practitionerIds: string[] },
>(practitionerId: string, rooms: T[]): string[] {
  return sortRooms(rooms.filter(
    (r) => r.practitionerIds.length === 0 || r.practitionerIds.includes(practitionerId),
  )).map((r) => r.room.id);
}
