import { describe, expect, it } from "vitest";
import { type Navigation, openRecordAt, recordHash } from "../../src/ui/address";
import { botOf, withModel } from "../../src/ui/bots";
import { HUMAN, type Players } from "../../src/ui/controller";
import { openLink } from "../../src/ui/gamesCard";
import { type FinishedGame, type GameRecord, GameHistory, HISTORY_KEY, playersOf, type StorageLike } from "../../src/ui/history";
import { seatsForLink, seatsOf } from "../../src/ui/setupLink";

const NORMAL = botOf("normal");
/** The bot the owner watched: the network at 32 simulations with Vary moves on, which no preset is (Custom). */
const CUSTOM_32 = { engine: "network", simulations: 32, vary: true } as const;
const DEFAULTS: Players = { p1: HUMAN, p2: botOf("strong") };

const finished = (p1: FinishedGame["p1"], p2: FinishedGame["p2"]): FinishedGame => ({ size: 9, p1, p2, winner: "p2", reason: "goal", moves: ["e2", "e8", "e3"], seatChanged: false });

/** The players an address seats, as the page reads it when it opens it. */
function seatedBy(hash: string, size: number): Players {
  const linked = seatsOf(hash, size);
  expect(linked).not.toBeNull();
  expect(linked!.unreadable).toEqual([]);
  return seatsForLink(linked!, DEFAULTS, Number(new URLSearchParams(hash.slice(1)).get("m")!.split(".").length));
}
const restored = (record: GameRecord): Players => seatedBy(recordHash(record), record.size);

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem = (key: string): string | null => this.items.get(key) ?? null;
  setItem = (key: string, value: string): void => void this.items.set(key, value);
  removeItem = (key: string): void => void this.items.delete(key);
}

const saved = (rows: readonly object[]): readonly GameRecord[] => {
  const storage = new MemoryStorage();
  storage.items.set(HISTORY_KEY, JSON.stringify({ v: 1, games: rows }));
  return new GameHistory(storage).games;
};

describe("the link that opens a recorded game", () => {
  it("names both players as they played, so two bots stay two bots and keep their settings", () => {
    const record = new GameHistory().add(finished(NORMAL, CUSTOM_32));
    expect(recordHash(record)).toBe("#n=9&p1=h100&p2=n32v&m=e2.e8.e3");
    expect(restored(record)).toEqual({ p1: NORMAL, p2: CUSTOM_32 });
  });

  it("keeps a person where a person sat, on either side, and a bot's model", () => {
    const model = withModel(botOf("max"), "fc-9x9-a");
    const history = new GameHistory();
    expect(restored(history.add(finished(HUMAN, CUSTOM_32)))).toEqual({ p1: HUMAN, p2: CUSTOM_32 });
    expect(restored(history.add(finished(model, HUMAN)))).toEqual({ p1: model, p2: HUMAN });
    expect(restored(history.add(finished(HUMAN, HUMAN)))).toEqual({ p1: HUMAN, p2: HUMAN });
  });

  it("restores what playersOf reads from the record, for every record", () => {
    const history = new GameHistory();
    for (const [p1, p2] of [[NORMAL, CUSTOM_32], [CUSTOM_32, NORMAL], [HUMAN, NORMAL], [botOf("beginner"), botOf("beginner")]] as const) {
      const record = history.add(finished(p1, p2));
      expect(restored(record)).toEqual(playersOf(record));
    }
  });

  it("is the Games card's Open link too, so a new tab opens the same players", () => {
    const record = new GameHistory().add(finished(NORMAL, CUSTOM_32));
    expect(openLink(record)).toEqual({ href: "#n=9&p1=h100&p2=n32v&m=e2.e8.e3", label: "Open game 1, on a 9 by 9 board" });
    expect(seatedBy(openLink(record).href, 9)).toEqual({ p1: NORMAL, p2: CUSTOM_32 });
  });
});

describe("opening a recorded game in place", () => {
  const record = new GameHistory().add(finished(NORMAL, CUSTOM_32));
  const hash = "#n=9&p1=h100&p2=n32v&m=e2.e8.e3";

  /** A navigation that logs what happens, in order. */
  const logged = (at: string) => {
    const log: string[] = [];
    const navigation: Navigation = { hash: at, push: (pushed) => void log.push(`push ${pushed}`) };
    const open = (opened: string): boolean => {
      log.push(`open ${opened}`);
      return true;
    };
    return { log, navigation, open };
  };

  it("adds the game's address to the session history, then opens it, so Back returns to the game before", () => {
    const { log, navigation, open } = logged("#n=9&p1=p&p2=n32&m=e2");
    expect(openRecordAt(record, navigation, open)).toBe(true);
    expect(log).toEqual([`push ${hash}`, `open ${hash}`]);
  });

  it("adds no second entry when the address already is the game's, and says whether it opened", () => {
    const { log, navigation } = logged(hash);
    expect(openRecordAt(record, navigation, () => false)).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("stored rows and the link", () => {
  const row = (extra: object) => ({ id: 1, size: 9, winner: "p1", reason: "goal", moves: "e2.e8", ...extra });

  it("reads rows as stored, and fits their simulations to the board's steps and cap when the link is opened", () => {
    const big = { kind: "bot", engine: "network", simulations: 100_000, vary: false };
    const odd = { kind: "bot", engine: "heuristic", simulations: 30, vary: true };
    const [on9, on11] = saved([row({ p1: big, p2: odd }), row({ id: 2, size: 11, p1: big, p2: { kind: "human" } })]);
    expect(on9!.p1).toEqual(big);
    expect(on9!.p2).toEqual(odd);
    expect(restored(on9!)).toEqual({ p1: { engine: "network", simulations: 800, vary: false }, p2: { engine: "heuristic", simulations: 25, vary: true } });
    expect(restored(on11!)).toEqual({ p1: { engine: "network", simulations: 400, vary: false }, p2: HUMAN });
  });

  it("drops rows with a seat missing or hostile instead of putting them in a link", () => {
    const bot = { kind: "bot", engine: "network", simulations: 32, vary: true };
    const bad = [
      row({ p2: bot }),
      row({ p1: { ...bot, model: "x&p1=p" }, p2: bot }),
      row({ p1: { ...bot, simulations: "32&m=" }, p2: bot }),
      row({ p1: { kind: "person" }, p2: bot }),
      row({ p1: null, p2: bot }),
      row({ p1: bot, p2: { kind: "bot", engine: "network", simulations: 32 } }),
    ];
    expect(saved(bad)).toEqual([]);
  });
});
