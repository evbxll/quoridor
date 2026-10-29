import { describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import type { Game, Result } from "../../src/engine/game";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import { type AutoHost, AutoPlay, COUNTDOWN_SECONDS, MAX_AUTO_GAMES, type Schedule } from "../../src/ui/autoplay";
import { botOf } from "../../src/ui/bots";
import { GameController, HUMAN, type Players, type SearchPort } from "../../src/ui/controller";
import { openingFor } from "../../src/ui/openings";

const [BEGINNER, NORMAL] = [botOf("beginner"), botOf("normal")];

/** A page by hand: a game is "on" until the test ends it. */
class FakeHost implements AutoHost {
  size = 7;
  players: Players = { p1: BEGINNER, p2: NORMAL };
  running = false;
  result: Result | null = null;
  moves: readonly string[] = [];
  loads: { moves: readonly string[]; players: Players }[] = [];
  starts = 0;

  get hasHuman(): boolean {
    return this.players.p1 === HUMAN || this.players.p2 === HUMAN;
  }

  load(game: Game, players: Players): void {
    this.loads.push({ moves: game.moves, players });
    this.moves = game.moves;
    this.players = players;
    this.result = null;
    this.running = false;
  }

  start(): void {
    this.starts++;
    this.running = true;
  }

  finish(winner: "p1" | "p2" = "p1"): void {
    this.running = false;
    this.result = { winner, reason: "goal" };
  }
}

/** Timers the test runs by hand. */
class Clock {
  private pending: (() => void)[] = [];
  readonly schedule: Schedule = (fn) => {
    this.pending.push(fn);
    return () => {
      this.pending = this.pending.filter((p) => p !== fn);
    };
  };

  get waiting(): number {
    return this.pending.length;
  }

  /** One second goes by. */
  tick(): void {
    const due = this.pending;
    this.pending = [];
    for (const fn of due) fn();
  }
}

function setup() {
  const host = new FakeHost();
  const clock = new Clock();
  const changes = vi.fn();
  const auto = new AutoPlay(host, () => 0.25, changes, clock.schedule);
  auto.enabled = true;
  return { host, clock, auto, changes };
}

/** The page tells auto-play after every change. */
const settle = (auto: AutoPlay): void => auto.update();

describe("AutoPlay", () => {
  it("begins with a varied opening when Start is pressed on a fresh game", () => {
    const { host, auto } = setup();
    auto.start();
    expect(host.loads).toHaveLength(1);
    expect(host.loads[0]!.moves).toEqual(openingFor(7, Math.floor(0.25 * 2 ** 32), 0));
    expect(host.loads[0]!.players).toEqual({ p1: BEGINNER, p2: NORMAL });
    expect(host.starts).toBe(1);
    expect(auto.active).toBe(true);
  });

  it("plays a fresh game as it is when openings are off, or when auto-play is off", () => {
    const off = setup();
    off.auto.enabled = false;
    off.auto.start();
    expect(off.host.loads).toEqual([]);
    expect(off.host.starts).toBe(1);
    expect(off.auto.active).toBe(false);
    const plain = setup();
    plain.auto.variedOpenings = false;
    plain.auto.start();
    expect(plain.host.loads).toEqual([]);
    expect(plain.auto.active).toBe(true);
  });

  it("counts down 3, 2, 1 after a game, says it once, then starts the next with sides swapped", () => {
    const { host, clock, auto } = setup();
    auto.start();
    settle(auto);
    expect(auto.countdown).toBeNull();
    host.finish();
    settle(auto);
    settle(auto);
    expect(auto.countdown).toBe(COUNTDOWN_SECONDS);
    expect(auto.message).toBe("Next game in 3 s");
    expect(auto.takeAnnouncement()).toBe("Next game in 3 seconds. Choose Cancel to stop.");
    expect(auto.takeAnnouncement()).toBeNull();
    clock.tick();
    expect(auto.message).toBe("Next game in 2 s");
    clock.tick();
    expect(auto.message).toBe("Next game in 1 s");
    expect(host.loads).toHaveLength(1);
    clock.tick();
    expect(host.loads).toHaveLength(2);
    expect(host.loads[1]!.players).toEqual({ p1: NORMAL, p2: BEGINNER });
    expect(host.loads[1]!.moves).toEqual(openingFor(7, Math.floor(0.25 * 2 ** 32), 1));
    expect(host.loads[1]!.moves).not.toEqual(host.loads[0]!.moves);
    expect(host.running).toBe(true);
    expect(auto.countdown).toBeNull();
    host.finish();
    settle(auto);
    for (let i = 0; i < COUNTDOWN_SECONDS; i++) clock.tick();
    expect(host.loads[2]!.players).toEqual({ p1: BEGINNER, p2: NORMAL });
  });

  it("keeps the sides when swapping is off, and starts from the standard position without openings", () => {
    const { host, clock, auto } = setup();
    auto.swapSides = false;
    auto.variedOpenings = false;
    auto.start();
    host.finish();
    settle(auto);
    for (let i = 0; i < COUNTDOWN_SECONDS; i++) clock.tick();
    expect(host.loads).toHaveLength(1);
    expect(host.loads[0]).toEqual({ moves: [], players: { p1: BEGINNER, p2: NORMAL } });
  });

  it("stops when Cancel is pressed, with no further game", () => {
    const { host, clock, auto } = setup();
    auto.start();
    host.finish();
    settle(auto);
    clock.tick();
    auto.cancel();
    expect(auto.active).toBe(false);
    expect(auto.countdown).toBeNull();
    expect(auto.message).toBe("Auto-play cancelled.");
    expect(clock.waiting).toBe(0);
    clock.tick();
    expect(host.loads).toHaveLength(1);
  });

  it("stops when the box is unticked, during a game and during the countdown", () => {
    const first = setup();
    first.auto.start();
    first.auto.setEnabled(false);
    first.host.finish();
    settle(first.auto);
    expect(first.auto.countdown).toBeNull();
    const second = setup();
    second.auto.start();
    second.host.finish();
    settle(second.auto);
    second.auto.setEnabled(false);
    expect(second.clock.waiting).toBe(0);
    expect(second.host.loads).toHaveLength(1);
  });

  it("stops on Pause, and a paused run does not count down at the end of the game", () => {
    const { host, auto } = setup();
    auto.start();
    auto.pause();
    host.finish();
    settle(auto);
    expect(auto.active).toBe(false);
    expect(auto.countdown).toBeNull();
    expect(auto.message).toBe("Auto-play paused.");
  });

  it("stops, and says so aloud, when a seat becomes a person", () => {
    const { host, clock, auto } = setup();
    auto.start();
    host.finish();
    settle(auto);
    auto.takeAnnouncement();
    host.players = { p1: HUMAN, p2: NORMAL };
    settle(auto);
    expect(auto.active).toBe(false);
    expect(auto.takeAnnouncement()).toBe("Auto-play stopped: a person plays a side.");
    expect(clock.waiting).toBe(0);
    expect(host.loads).toHaveLength(1);
  });

  it("does not start a game over one that is running, or over a person's", () => {
    const { host, clock, auto } = setup();
    auto.start();
    host.finish();
    settle(auto);
    clock.tick();
    clock.tick();
    // Somebody started another game by hand during the last second.
    host.result = null;
    host.running = true;
    clock.tick();
    expect(host.loads).toHaveLength(1);
    expect(auto.active).toBe(false);
  });

  it("stops after the cap and says so", () => {
    const { host, clock, auto } = setup();
    auto.variedOpenings = false;
    auto.start();
    for (let game = 1; game < MAX_AUTO_GAMES; game++) {
      host.finish();
      settle(auto);
      for (let i = 0; i < COUNTDOWN_SECONDS; i++) clock.tick();
    }
    expect(host.loads).toHaveLength(MAX_AUTO_GAMES - 1);
    host.finish();
    settle(auto);
    expect(auto.active).toBe(false);
    expect(auto.countdown).toBeNull();
    expect(auto.message).toBe(`Auto-play stopped after ${MAX_AUTO_GAMES} games.`);
  });

  it("begins when the box is ticked during a game the bots are playing, and not when they are paused", () => {
    const running = setup();
    running.auto.enabled = false;
    running.host.running = true;
    running.auto.setEnabled(true);
    expect(running.auto.active).toBe(true);
    const paused = setup();
    paused.auto.enabled = false;
    paused.auto.setEnabled(true);
    expect(paused.auto.active).toBe(false);
  });

  it("does not start a run with a person at the board", () => {
    const { host, auto } = setup();
    host.players = { p1: HUMAN, p2: NORMAL };
    auto.start();
    expect(auto.active).toBe(false);
    expect(host.loads).toEqual([]);
  });
});

/** An engine that answers at once with the first legal move. */
class FirstMoveEngine implements SearchPort {
  async search(params: SearchParams): Promise<SearchResponse | null> {
    const state = GameState.initial(params.size);
    for (const move of params.moves) state.play(parseMove(state, move));
    const move = formatAction(state, state.legalActions()[0]!);
    return { type: "result", id: 0, move, moves: [move], visits: [1], value: 0, principalVariation: [move] };
  }

  cancel(): void {}
}

describe("AutoPlay with a game controller", () => {
  it("plays three whole games in a row with the sides swapped, each from a different opening", async () => {
    const controller = new GameController(new FirstMoveEngine(), () => {}, () => 0.5);
    controller.setSpeed("instant");
    const finished: { hash: string; players: Players }[] = [];
    const host: AutoHost = {
      get size() {
        return controller.size;
      },
      get players() {
        return controller.players;
      },
      get hasHuman() {
        return controller.hasHuman;
      },
      get running() {
        return controller.running;
      },
      get result() {
        return controller.result;
      },
      get moves() {
        return controller.moves;
      },
      load: (game, players) => controller.load(game, players),
      start: () => controller.start(),
    };
    const clock = new Clock();
    const auto = new AutoPlay(host, () => 0.5, () => {}, clock.schedule);
    auto.enabled = true;
    controller.newGame(5, { p1: BEGINNER, p2: NORMAL });
    auto.start();
    for (let game = 0; game < 3; game++) {
      for (let spin = 0; spin < 500 && controller.result === null; spin++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controller.result).not.toBeNull();
      finished.push({ hash: controller.hash, players: controller.players });
      auto.update();
      for (let i = 0; i < COUNTDOWN_SECONDS; i++) clock.tick();
    }
    expect(finished.map((g) => g.players.p1 === BEGINNER)).toEqual([true, false, true]);
    expect(new Set(finished.map((g) => g.hash)).size).toBe(3);
    for (const [index, game] of finished.entries()) {
      const opening = openingFor(5, Math.floor(0.5 * 2 ** 32), index).join(".");
      expect(game.hash.startsWith(`#n=5&m=${opening}.`)).toBe(true);
    }
  });
});
