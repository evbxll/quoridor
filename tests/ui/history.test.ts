import { describe, expect, it } from "vitest";
import { botOf, withModel } from "../../src/ui/bots";
import { HUMAN } from "../../src/ui/controller";
import { type FinishedGame, GameHistory, HISTORY_KEY, isMirror, MAX_GAMES, MAX_SAVED_CHARS, resultText, seatKey, seatNames, type StorageLike } from "../../src/ui/history";

const [BEGINNER, STRONG, NORMAL] = [botOf("beginner"), botOf("strong"), botOf("normal")];

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem = (key: string): string | null => this.items.get(key) ?? null;
  setItem = (key: string, value: string): void => {
    if (this.failWrites) throw new Error("full");
    this.items.set(key, value);
  };
  removeItem = (key: string): void => void this.items.delete(key);
}

const game = (over: Partial<FinishedGame> = {}): FinishedGame => ({ size: 7, p1: BEGINNER, p2: STRONG, winner: "p1", reason: "goal", moves: ["d2", "d6", "d3"], ...over });

describe("resultText", () => {
  it("names each way a game ends, in words", () => {
    expect(resultText("p1", "goal")).toBe("Player 1 wins");
    expect(resultText("p2", "goal")).toBe("Player 2 wins");
    expect(resultText("draw", "repetition")).toBe("Draw: repetition");
    expect(resultText("draw", "cap")).toBe("Draw: move limit");
  });
});

describe("seat names and keys", () => {
  it("names bots by preset, engine and searches, and a person You or Person", () => {
    const history = new GameHistory();
    history.add(game());
    history.add(game({ p1: HUMAN, p2: BEGINNER }));
    history.add(game({ p1: HUMAN, p2: HUMAN }));
    const [a, b, c] = history.games;
    expect(seatNames(a!)).toEqual({ p1: "Beginner (heuristic, 5, varied)", p2: "Strong (network, 32)" });
    expect(seatNames(b!)).toEqual({ p1: "You", p2: "Beginner (heuristic, 5, varied)" });
    expect(seatNames(c!)).toEqual({ p1: "Person", p2: "Person" });
  });

  it("tells bots apart by engine, searches and variation, and not by preset name", () => {
    const keys = [BEGINNER, STRONG, NORMAL, { ...NORMAL, vary: true }, { ...NORMAL, simulations: 50 }, { ...NORMAL, engine: "network" as const }].map((bot) => seatKey({ kind: "bot", ...bot }));
    expect(new Set(keys).size).toBe(keys.length);
    expect(seatKey({ kind: "bot", ...NORMAL })).toBe(seatKey({ kind: "bot", ...botOf("normal") }));
  });
});

describe("GameHistory", () => {
  it("adds games with rising numbers and the link's move list", () => {
    const history = new GameHistory();
    history.add(game());
    history.add(game({ winner: "draw", reason: "cap", moves: ["e2"] }));
    expect(history.games.map((g) => g.id)).toEqual([1, 2]);
    expect(history.games[0]).toMatchObject({ size: 7, winner: "p1", reason: "goal", moves: "d2.d6.d3" });
  });

  it("keeps the newest MAX_GAMES and tallies the kept games only", () => {
    const history = new GameHistory();
    history.add(game({ winner: "p2" }));
    for (let i = 0; i < MAX_GAMES; i++) history.add(game());
    expect(history.games).toHaveLength(MAX_GAMES);
    expect(history.games[0]!.id).toBe(2);
    const beginner = history.tallies().find((t) => t.name.startsWith("Beginner"))!;
    expect(beginner).toMatchObject({ wins: MAX_GAMES, losses: 0, draws: 0, score: 1 });
  });

  it("tallies wins, losses and draws per identity, a draw counting half", () => {
    const history = new GameHistory();
    history.add(game({ winner: "p1" }));
    history.add(game({ winner: "p2" }));
    history.add(game({ p1: STRONG, p2: BEGINNER, winner: "p1" }));
    history.add(game({ winner: "draw", reason: "repetition" }));
    const [beginner, strong] = [history.tallies().find((t) => t.name.startsWith("Beginner"))!, history.tallies().find((t) => t.name.startsWith("Strong"))!];
    expect(beginner).toMatchObject({ wins: 1, losses: 2, draws: 1, score: 1.5 / 4 });
    expect(strong).toMatchObject({ wins: 2, losses: 1, draws: 1, score: 2.5 / 4 });
  });

  it("lists mirror matches but leaves them out of the tally", () => {
    const history = new GameHistory();
    history.add(game({ p1: NORMAL, p2: { ...NORMAL } }));
    history.add(game({ p1: HUMAN, p2: HUMAN }));
    history.add(game({ p1: NORMAL, p2: STRONG }));
    expect(history.games.map(isMirror)).toEqual([true, true, false]);
    expect(history.tallies().map((t) => [t.name, t.wins, t.losses])).toEqual([
      ["Normal (heuristic, 100)", 1, 0],
      ["Strong (network, 32)", 0, 1],
    ]);
  });

  it("lists a person against a bot as You", () => {
    const history = new GameHistory();
    history.add(game({ p1: HUMAN, p2: NORMAL, winner: "p2" }));
    expect(history.tallies().map((t) => [t.name, t.wins, t.losses])).toEqual([
      ["Normal (heuristic, 100)", 1, 0],
      ["You", 0, 1],
    ]);
  });

  it("clears the games, the numbering and the saved copy", () => {
    const storage = new MemoryStorage();
    const history = new GameHistory(storage);
    history.add(game());
    history.clear();
    expect(history.games).toEqual([]);
    expect(storage.items.has(HISTORY_KEY)).toBe(false);
    expect(history.add(game()).id).toBe(1);
  });
});

describe("GameHistory saved in storage", () => {
  it("comes back after a reload with the same games, and goes on numbering after them", () => {
    const storage = new MemoryStorage();
    const first = new GameHistory(storage);
    first.add(game());
    first.add(game({ p1: HUMAN, p2: NORMAL, winner: "draw", reason: "cap" }));
    const second = new GameHistory(storage);
    expect(second.games).toEqual(first.games);
    expect(second.add(game()).id).toBe(3);
  });

  it("ignores text that is not JSON, the wrong version, and the wrong shape", () => {
    for (const text of ["{not json", "null", "[]", '{"v":2,"games":[]}', '{"v":1}', '{"v":1,"games":"x"}', "x".repeat(MAX_SAVED_CHARS + 1)]) {
      const storage = new MemoryStorage();
      storage.items.set(HISTORY_KEY, text);
      expect(new GameHistory(storage).games).toEqual([]);
    }
  });

  it("drops saved games with a field out of range and keeps the good ones", () => {
    const good = { id: 1, size: 7, p1: { kind: "bot", engine: "heuristic", simulations: 5, vary: true }, p2: { kind: "human" }, winner: "p2", reason: "goal", moves: "d2.d6" };
    const bad = [
      { ...good, size: 99 },
      { ...good, winner: "p3" },
      { ...good, winner: "draw" },
      { ...good, reason: "cap" },
      { ...good, moves: "<img src=x onerror=alert(1)>" },
      { ...good, moves: "" },
      { ...good, p1: { kind: "bot", engine: "gpt", simulations: 5, vary: true } },
      { ...good, p1: { kind: "bot", engine: "network", simulations: -1, vary: true } },
      { ...good, p2: { kind: "bot", engine: "network", simulations: 5, vary: "yes" } },
      { ...good, id: "1" },
      "text",
      null,
    ];
    const storage = new MemoryStorage();
    storage.items.set(HISTORY_KEY, JSON.stringify({ v: 1, games: [...bad, { ...good, id: 4 }] }));
    const history = new GameHistory(storage);
    expect(history.games.map((g) => g.id)).toEqual([4]);
    expect(history.add(game()).id).toBe(5);
  });

  it("keeps at most MAX_GAMES of a longer saved list", () => {
    const row = (id: number) => ({ id, size: 7, p1: { kind: "human" }, p2: { kind: "human" }, winner: "p1", reason: "goal", moves: "d2" });
    const storage = new MemoryStorage();
    storage.items.set(HISTORY_KEY, JSON.stringify({ v: 1, games: Array.from({ length: MAX_GAMES + 5 }, (_, i) => row(i + 1)) }));
    const history = new GameHistory(storage);
    expect(history.games).toHaveLength(MAX_GAMES);
    expect(history.games[0]!.id).toBe(6);
  });

  it("cuts the oldest games when the saved text would pass its size limit", () => {
    const storage = new MemoryStorage();
    const history = new GameHistory(storage);
    const long = Array.from({ length: 1500 }, (_, i) => `a${i % 9}`);
    for (let i = 0; i < 180; i++) history.add(game({ moves: long }));
    expect(storage.items.get(HISTORY_KEY)!.length).toBeLessThanOrEqual(MAX_SAVED_CHARS);
    expect(history.games.length).toBeLessThan(180);
    expect(new GameHistory(storage).games).toEqual(history.games);
  });

  it("still works in memory when storage is blocked or full", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const history = new GameHistory(storage);
    history.add(game());
    expect(history.games).toHaveLength(1);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const blocked = new GameHistory(throwing);
    blocked.add(game());
    blocked.clear();
    expect(blocked.games).toEqual([]);
  });
});

describe("models in the history", () => {
  const MODEL = withModel(STRONG, "fc-9x9-a");

  it("treats the same preset with another model as another bot, in keys, names, tally and mirror matches", () => {
    expect(seatKey({ kind: "bot", ...MODEL })).not.toBe(seatKey({ kind: "bot", ...STRONG }));
    const history = new GameHistory();
    history.add(game({ p1: STRONG, p2: MODEL }));
    history.add(game({ p1: STRONG, p2: botOf("strong") }));
    expect(history.games.map(isMirror)).toEqual([false, true]);
    expect(seatNames(history.games[0]!)).toEqual({ p1: "Strong (network, 32)", p2: "Strong (network, 32, fc-9x9-a)" });
    expect(history.tallies().map((t) => [t.name, t.wins, t.losses])).toEqual([
      ["Strong (network, 32, fc-9x9-a)", 0, 1],
      ["Strong (network, 32)", 1, 0],
    ]);
  });

  it("keeps the model through a reload, and reads a row saved before models as the main model", () => {
    const storage = new MemoryStorage();
    const first = new GameHistory(storage);
    first.add(game({ p1: MODEL, p2: STRONG }));
    expect(new GameHistory(storage).games).toEqual(first.games);
    const old = { id: 1, size: 7, p1: { kind: "bot", engine: "network", simulations: 32, vary: false }, p2: { kind: "human" }, winner: "p1", reason: "goal", moves: "d2" };
    storage.items.set(HISTORY_KEY, JSON.stringify({ v: 1, games: [old] }));
    const read = new GameHistory(storage).games[0]!;
    expect(seatKey(read.p1)).toBe(seatKey({ kind: "bot", ...STRONG }));
    expect(seatNames(read).p1).toBe("Strong (network, 32)");
  });

  it("drops saved rows with a model that is not plain text, or on a heuristic bot", () => {
    const row = (p1: object) => ({ id: 1, size: 7, p1, p2: { kind: "human" }, winner: "p1", reason: "goal", moves: "d2" });
    const net = { kind: "bot", engine: "network", simulations: 32, vary: false };
    const storage = new MemoryStorage();
    storage.items.set(HISTORY_KEY, JSON.stringify({ v: 1, games: [row({ ...net, model: "<img>" }), row({ ...net, model: 5 }), row({ ...net, model: "" }), row({ ...net, engine: "heuristic", model: "fc-9x9-a" }), row({ ...net, model: "x".repeat(200) })] }));
    expect(new GameHistory(storage).games).toEqual([]);
  });
});
