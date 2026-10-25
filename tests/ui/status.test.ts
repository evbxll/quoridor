import { describe, expect, it } from "vitest";
import { parseMove } from "../../src/engine/notation";
import { Game } from "../../src/engine/game";
import { GameController } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";
import { moveRows, statusText } from "../../src/ui/status";

const idle = { search: () => new Promise<never>(() => {}), cancel: () => {} };

function loaded(hash: string): GameController {
  const controller = new GameController(idle, () => {});
  controller.load(Game.fromHash(hash), LEVELS[1]!);
  return controller;
}

describe("statusText", () => {
  it("says whose move it is and the walls left", () => {
    expect(statusText(loaded("#n=5&m=c2.c4"))).toBe("The bot played c4. Your move. Walls left: you 3, bot 3.");
    expect(statusText(loaded("#n=5&m=c2.c4.b3h"))).toBe("The bot played b3h. Your move. Walls left: you 3, bot 2.");
  });

  it("says the bot is thinking", () => {
    const controller = new GameController(idle, () => {});
    controller.newGame(5, "p2", LEVELS[1]!);
    expect(statusText(controller)).toBe("The bot is thinking.");
  });

  it("states the result and its reason", () => {
    expect(statusText(loaded("#n=5&m=c2.b5.c3.a5.c4.b5.c5"))).toBe("You played c5. You win by reaching the goal row.");
    expect(statusText(loaded("#n=5&m=c2.c4.c1.c5.c2.c4.c1.c5"))).toBe("The bot played c5. Draw by threefold repetition.");
  });

  it("says the bot won when it reached its goal first", async () => {
    const script = ["c2", "c3", "c4", "c5"];
    const port = {
      search: async () => ({ type: "result" as const, id: 0, move: script.shift()!, moves: [], visits: [], value: 0, principalVariation: [] }),
      cancel: () => {},
    };
    const controller = new GameController(port, () => {});
    controller.newGame(5, "p2", LEVELS[1]!);
    for (const move of ["b5", "a5", "b5"]) {
      await new Promise((resolve) => setImmediate(resolve));
      controller.playHuman(parseMove(controller.state, move));
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(statusText(controller)).toBe("The bot played c5. The bot wins by reaching the goal row.");
  });
});

describe("moveRows", () => {
  it("pairs the moves of each turn", () => {
    expect(moveRows(["e2", "e8", "d4h"])).toEqual([["e2", "e8"], ["d4h"]]);
    expect(moveRows([])).toEqual([]);
  });
});
