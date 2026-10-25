import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerAction } from "../../src/engine/actions";
import { actionCount, maxPlies } from "../../src/engine/constants";
import { Game } from "../../src/engine/game";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";

interface FixtureGame {
  size: number;
  actions: number[];
  moves: string[];
  winner: string;
  reason: string;
}

const data = JSON.parse(readFileSync(new URL("../../fixtures/games.json", import.meta.url), "utf8")) as {
  games: FixtureGame[];
  action_names: Record<string, { p1: string[]; p2: string[] }>;
};

describe("notation", () => {
  it("names every action index as Python does, for both movers", () => {
    for (const [size, names] of Object.entries(data.action_names)) {
      const start = GameState.initial(Number(size));
      const second = GameState.fromKey(start.positionKey().replace("|1|", "|2|"));
      expect(names.p1).toHaveLength(actionCount(Number(size)));
      names.p1.forEach((name, i) => expect(formatAction(start, playerAction(i))).toBe(name));
      names.p2.forEach((name, i) => expect(formatAction(second, playerAction(i))).toBe(name));
    }
  });

  it("parses the legal moves of a position and nothing else", () => {
    const state = GameState.initial(9);
    expect(parseMove(state, "e2")).toBe(0);
    expect(parseMove(state, "d4h")).toBe(state.legalActions().find((a) => formatAction(state, a) === "d4h"));
    for (const text of ["E2", " e2", "e2 ", "e3", "e1", "d4", "d4H", "", "e2h2"]) {
      expect(() => parseMove(state, text), text).toThrow("not a legal move");
    }
  });
});

describe("Game against games.json", () => {
  it("replays every fixture game to Python's names, result and reason", () => {
    const counts = new Map<string, number>();
    for (const fixture of data.games) {
      const game = new Game(fixture.size);
      fixture.actions.forEach((action, ply) => {
        expect(game.result).toBeNull();
        game.play(playerAction(action));
        expect(game.moves[ply]).toBe(fixture.moves[ply]);
      });
      expect(game.result).toEqual({ winner: fixture.winner, reason: fixture.reason });
      expect(() => game.play(playerAction(0))).toThrow("The game is over");
      const kind = `${fixture.winner}/${fixture.reason}`;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["draw/cap", "draw/repetition", "p1/goal", "p2/goal"]);
  });

  it("draws at the cap on each size after maxPlies moves", () => {
    for (const fixture of data.games.filter((g) => g.reason === "cap")) {
      expect(fixture.actions).toHaveLength(maxPlies(fixture.size));
    }
  });

  it("replays the games from their notation", () => {
    for (const fixture of data.games) {
      const game = new Game(fixture.size);
      for (const move of fixture.moves) game.playMove(move);
      expect(game.result).toEqual({ winner: fixture.winner, reason: fixture.reason });
    }
  });
});

describe("Game", () => {

  it("draws on the third occurrence of the start position, counting the start", () => {
    // Pawns on 5x5 shuffle left and right back to the start position.
    const game = new Game(5);
    const moves = ["b1", "b5", "c1", "c5", "b1", "b5", "c1"];
    moves.slice(0, -1).forEach((m) => game.playMove(m));
    expect(game.result).toBeNull();
    game.playMove(moves.at(-1)!);
    expect(game.result).toBeNull();
    game.playMove("c5");
    expect(game.result).toEqual({ winner: "draw", reason: "repetition" });
    expect(game.moves).toHaveLength(8);
  });

  it("undoes moves, the result and the repetition counts", () => {
    const game = new Game(5);
    const start = game.state.positionKey();
    for (const m of ["b1", "b5", "c1", "c5", "b1", "b5", "c1", "c5"]) game.playMove(m);
    expect(game.result?.reason).toBe("repetition");
    game.undo(2);
    expect(game.result).toBeNull();
    expect(game.moves).toHaveLength(6);
    game.playMove("c1");
    game.playMove("c5");
    expect(game.result?.reason).toBe("repetition");
    game.undo(8);
    expect(game.state.positionKey()).toBe(start);
    expect(game.moves).toEqual([]);
    expect(() => game.undo()).toThrow("Nothing to undo");
  });

  it("round-trips through the URL hash", () => {
    const game = new Game(9);
    for (const m of ["e2", "e8", "d4h", "e7"]) game.playMove(m);
    expect(game.toHash()).toBe("#n=9&m=e2.e8.d4h.e7");
    const copy = Game.fromHash(game.toHash());
    expect(copy.state.positionKey()).toBe(game.state.positionKey());
    expect(Game.fromHash("#n=7&m=").moves).toEqual([]);
  });

  it("rejects bad hashes", () => {
    expect(() => Game.fromHash("#m=e2")).toThrow("board size");
    expect(() => Game.fromHash("#n=1000&m=")).toThrow("board size");
    expect(() => Game.fromHash("#n=9&m=e2.e2")).toThrow("not a legal move");
    for (const n of ["", "9.5", "0x9", "+9", " 9", "9e0", "-9", "abc"]) {
      expect(() => Game.fromHash("#n=" + encodeURIComponent(n) + "&m="), n).toThrow("board size");
    }
    expect(() => Game.fromHash("#n=9&n=7&m=")).toThrow("repeats");
    expect(() => Game.fromHash("#n=9&m=e2&m=e2")).toThrow("repeats");
  });

  it("only undoes a whole number of plies of at least one", () => {
    const game = new Game(5);
    game.playMove("c2");
    for (const plies of [0, -1, 0.5, Number.NaN, Infinity]) {
      expect(() => game.undo(plies), String(plies)).toThrow("whole number");
    }
    expect(game.moves).toEqual(["c2"]);
  });

  it("hands out copies, so callers cannot desync the history", () => {
    const game = new Game(5);
    game.playMove("c2");
    const key = game.state.positionKey();
    game.state.play(playerAction(0));
    (game.moves as string[]).push("zz");
    expect(game.state.positionKey()).toBe(key);
    expect(game.moves).toEqual(["c2"]);
    game.undo();
    expect(game.state.positionKey()).toBe(new Game(5).state.positionKey());
  });
});
