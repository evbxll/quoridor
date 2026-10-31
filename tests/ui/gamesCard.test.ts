import { describe, expect, it } from "vitest";
import { LATEST, shownGames } from "../../src/ui/gamesCard";

describe("the games the Games card lists", () => {
  const games = Array.from({ length: 25 }, (_, i) => i + 1);

  it("are the latest ten, newest first, until Show all", () => {
    expect(LATEST).toBe(10);
    expect(shownGames(games, false)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
  });

  it("are all of them, newest first, after Show all", () => {
    expect(shownGames(games, true)).toEqual([...games].reverse());
    expect(shownGames([1, 2], false)).toEqual([2, 1]);
  });
});
