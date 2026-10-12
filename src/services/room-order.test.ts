import { describe, expect, it } from "vitest";

import { allowedRoomIdsFor, sortRooms } from "./room-order";

function row(id: string, sortOrder: number, name: string, practitionerIds: string[] = [], allowAll = true) {
  return { room: { id, sortOrder, name, allowAll }, practitionerIds };
}

describe("sortRooms", () => {
  it("trie par sortOrder d'abord", () => {
    const out = sortRooms([row("b", 2, "A"), row("a", 1, "Z")]);
    expect(out.map((r) => r.room.id)).toEqual(["a", "b"]);
  });

  it("égalité de sortOrder : nom puis id", () => {
    const out = sortRooms([
      row("c", 0, "B"),
      row("b", 0, "A"),
      row("a", 0, "A"),
    ]);
    expect(out.map((r) => r.room.id)).toEqual(["a", "b", "c"]);
  });
});

describe("allowedRoomIdsFor", () => {
  it("allowAll = toutes les salles", () => {
    const rooms = [row("b", 1, "B"), row("a", 0, "A")];
    expect(allowedRoomIdsFor("p1", rooms)).toEqual(["a", "b"]);
  });

  it("filtre les salles réservées à d'autres", () => {
    const rooms = [
      row("open", 0, "Ouverte"),
      row("priv", 0, "Privée", ["p9"], false),
      row("mine", 0, "Mienne", ["p1"], false),
    ];
    expect(allowedRoomIdsFor("p1", rooms)).toEqual(["mine", "open"]);
  });

  it("allowAll faux + liste vide = personne", () => {
    const rooms = [row("none", 0, "Personne", [], false)];
    expect(allowedRoomIdsFor("p1", rooms)).toEqual([]);
  });
});
