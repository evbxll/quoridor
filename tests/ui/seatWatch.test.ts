import { describe, expect, it } from "vitest";
import { botOf, setModelLabel, withModel } from "../../src/ui/bots";
import { HUMAN } from "../../src/ui/controller";
import { drawSignature } from "../../src/ui/gamesCard";
import { GameHistory } from "../../src/ui/history";
import { SeatWatch } from "../../src/ui/seatWatch";

const [A, B] = [botOf("beginner"), botOf("normal")];

describe("SeatWatch", () => {
  it("follows the seats before the first move, then notices an edit", () => {
    const watch = new SeatWatch();
    watch.observe({ p1: A, p2: B }, 0);
    watch.observe({ p1: B, p2: B }, 0);
    expect(watch.seats).toEqual({ p1: B, p2: B });
    expect(watch.changed).toBe(false);
    watch.observe({ p1: B, p2: B }, 5);
    expect(watch.changed).toBe(false);
    watch.observe({ p1: B, p2: A }, 6);
    expect(watch.changed).toBe(true);
    expect(watch.seats).toEqual({ p1: B, p2: B });
  });

  it("notices a person taking a seat, and a bot's model changing", () => {
    const a = new SeatWatch();
    a.observe({ p1: A, p2: B }, 0);
    a.observe({ p1: HUMAN, p2: B }, 3);
    expect(a.changed).toBe(true);
    const b = new SeatWatch();
    const net = botOf("strong");
    b.observe({ p1: net, p2: B }, 0);
    b.observe({ p1: withModel(net, "fc-9x9-a"), p2: B }, 2);
    expect(b.changed).toBe(true);
  });

  it("starts afresh when a game begins with moves already played", () => {
    const watch = new SeatWatch();
    watch.observe({ p1: A, p2: B }, 0);
    watch.observe({ p1: B, p2: A }, 4);
    expect(watch.changed).toBe(true);
    watch.begin({ p1: B, p2: A });
    watch.observe({ p1: B, p2: A }, 4);
    expect(watch.changed).toBe(false);
    expect(watch.seats).toEqual({ p1: B, p2: A });
  });
});

describe("drawSignature", () => {
  it("changes when a model's name arrives, so the table is drawn again with it", () => {
    const history = new GameHistory();
    history.add({ size: 9, p1: withModel(botOf("strong"), "s9-conv-x"), p2: botOf("strong"), winner: "p1", reason: "goal", moves: ["e2"], seatChanged: false });
    const before = drawSignature(history.games);
    setModelLabel("s9-conv-x", "Conv, gen 50");
    expect(drawSignature(history.games)).not.toBe(before);
  });
});

describe("the game SeatWatch hands to the history", () => {
  const CUSTOM_32 = { engine: "network", simulations: 32, vary: true } as const;
  const ended = (players: { p1: typeof A | typeof HUMAN; p2: typeof A | typeof HUMAN }) => ({ size: 9, players, result: { winner: "p2", reason: "goal" } as const, moves: ["e2", "e8"] });

  it("has the seats the game began with, not the ones at its end, and says a seat changed", () => {
    const watch = new SeatWatch();
    watch.observe({ p1: B, p2: CUSTOM_32 }, 0);
    watch.observe({ p1: B, p2: CUSTOM_32 }, 1);
    watch.observe({ p1: HUMAN, p2: { ...CUSTOM_32, simulations: 16 } }, 2);
    expect(watch.finished(ended({ p1: HUMAN, p2: { ...CUSTOM_32, simulations: 16 } }))).toEqual({ size: 9, p1: B, p2: CUSTOM_32, winner: "p2", reason: "goal", moves: ["e2", "e8"], seatChanged: true });
  });

  it("has the seats at the end when it saw no start, unchanged", () => {
    expect(new SeatWatch().finished(ended({ p1: B, p2: CUSTOM_32 }))).toEqual({ size: 9, p1: B, p2: CUSTOM_32, winner: "p2", reason: "goal", moves: ["e2", "e8"], seatChanged: false });
  });
});
