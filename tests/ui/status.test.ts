import { describe, expect, it } from "vitest";
import { parseMove } from "../../src/engine/notation";
import { Game } from "../../src/engine/game";
import { GameController, HUMAN, type Players } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";
import { moveRows, playerName, statusText } from "../../src/ui/status";

const [NORMAL, STRONG] = [LEVELS[1]!, LEVELS[2]!];
const idle = { search: () => new Promise<never>(() => {}), cancel: () => {} };

function loaded(hash: string, players: Players): GameController {
  const controller = new GameController(idle, () => {});
  controller.load(Game.fromHash(hash), players);
  return controller;
}

describe("playerName", () => {
  it("calls the one person You, two people by number, and a bot by number and level", () => {
    expect(playerName({ p1: HUMAN, p2: STRONG }, "p1")).toBe("You");
    expect(playerName({ p1: HUMAN, p2: STRONG }, "p2")).toBe("Player 2 (Strong)");
    expect(playerName({ p1: HUMAN, p2: HUMAN }, "p2")).toBe("Player 2");
  });
});

describe("statusText", () => {
  it("says who played what and whose move it is", () => {
    expect(statusText(loaded("#n=5&m=c2.c4", { p1: HUMAN, p2: NORMAL }), "ready")).toBe("Player 2 (Normal) played c4. Your move.");
    expect(statusText(loaded("#n=5&m=c2", { p1: HUMAN, p2: HUMAN }), "ready")).toBe("Player 1 played c2. Player 2 to move.");
  });

  it("says which engine the bot is thinking with", () => {
    const heuristic = new GameController(idle, () => {});
    heuristic.newGame(5, { p1: NORMAL, p2: HUMAN });
    expect(statusText(heuristic, "ready")).toBe("Player 1 (Normal) is thinking (heuristic search).");
    const network = new GameController(idle, () => {});
    network.setNetworkReady(true);
    network.newGame(5, { p1: STRONG, p2: HUMAN });
    expect(statusText(network, "ready")).toBe("Player 1 (Strong) is thinking (neural network).");
  });

  it("says a network bot is waiting for the network, and where the network stands", () => {
    const controller = new GameController(idle, () => {});
    controller.newGame(5, { p1: STRONG, p2: HUMAN });
    expect(statusText(controller, "downloading, 40%")).toBe("Player 1 (Strong) is waiting for the network (downloading, 40%).");
  });

  it("asks for Start before two bots play, and says when they are paused", () => {
    expect(statusText(loaded("#n=5", { p1: NORMAL, p2: STRONG }), "ready")).toBe("Choose Start to watch the bots play.");
    expect(statusText(loaded("#n=5&m=c2", { p1: NORMAL, p2: STRONG }), "ready")).toBe("Player 1 (Normal) played c2. Paused.");
  });

  it("states the result and its reason", () => {
    expect(statusText(loaded("#n=5&m=c2.b5.c3.a5.c4.b5.c5", { p1: HUMAN, p2: NORMAL }), "ready")).toBe("You played c5. You win by reaching the goal row.");
    expect(statusText(loaded("#n=5&m=c2.c4.c1.c5.c2.c4.c1.c5", { p1: HUMAN, p2: NORMAL }), "ready")).toBe(
      "Player 2 (Normal) played c5. Draw by threefold repetition.",
    );
  });

  it("says the bot won when it reached its goal first", async () => {
    const script = ["c2", "c3", "c4", "c5"];
    const port = {
      search: async () => ({ type: "result" as const, id: 0, move: script.shift()!, moves: [], visits: [], value: 0, principalVariation: [] }),
      cancel: () => {},
    };
    const controller = new GameController(port, () => {});
    controller.newGame(5, { p1: NORMAL, p2: HUMAN });
    for (const move of ["b5", "a5", "b5"]) {
      await new Promise((resolve) => setImmediate(resolve));
      controller.playHuman(parseMove(controller.state, move));
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(statusText(controller, "ready")).toBe("Player 1 (Normal) played c5. Player 1 (Normal) wins by reaching the goal row.");
  });
});

describe("moveRows", () => {
  it("pairs the moves of each turn", () => {
    expect(moveRows(["e2", "e8", "d4h"])).toEqual([["e2", "e8"], ["d4h"]]);
    expect(moveRows([])).toEqual([]);
  });
});
