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
