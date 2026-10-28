import { describe, expect, it } from "vitest";
import { HeuristicEvaluator } from "../../src/ai/heuristic";
import { SearchClient } from "../../src/ai/searchClient";
import { createSearchService } from "../../src/ai/searchService";
import { maxPlies } from "../../src/engine/constants";
import { GameController, HUMAN, type Side } from "../../src/ui/controller";
import { botOf } from "../../src/ui/bots";
import { LoopbackWorker } from "../helpers/loopback";
import { findAction, pawnTargets } from "../../src/ui/targets";

/** The real search service and heuristic bot, in this thread instead of a worker. */
function heuristicClient(): SearchClient {
  const client = new SearchClient(() => new LoopbackWorker((post) => createSearchService(post, async () => new HeuristicEvaluator())));
  void client.configure({ kind: "heuristic" });
  return client;
}

/** Plays a whole game against the bot. The person always steps to the neighbouring cell closest to their goal. */
async function playOut(size: number, human: Side): Promise<GameController> {
  let wake: () => void = () => {};
  const controller = new GameController(heuristicClient(), () => wake(), () => 0.5);
  controller.newGame(size, human === "p1" ? { p1: HUMAN, p2: botOf("normal") } : { p1: botOf("normal"), p2: HUMAN });
  while (controller.result === null) {
    if (controller.error !== null) throw new Error(controller.error);
    if (controller.humanToMove) {
      const state = controller.state;
      const goalRow = human === "p1" ? 0 : size - 1;
      const best = pawnTargets(state).reduce((a, b) => (Math.abs(b.row - goalRow) < Math.abs(a.row - goalRow) ? b : a));
      controller.playHuman(findAction(state, { kind: "move", ...best })!);
    } else {
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  return controller;
}

describe("a whole game against the Normal bot, with no model", () => {
  for (const [size, human] of [[5, "p1"], [5, "p2"], [7, "p1"], [9, "p1"], [11, "p1"]] as const) {
    it(`finishes on ${size}x${size} with the person as ${human}`, async () => {
      const controller = await playOut(size, human);
      const result = controller.result!;
      expect(["goal", "repetition", "cap"]).toContain(result.reason);
      expect(controller.moves.length).toBeLessThanOrEqual(maxPlies(size));
      expect(controller.thinking).toBe(false);
      // The link replays to the same game.
      expect(controller.hash).toBe(`#n=${size}&m=${controller.moves.join(".")}`);
    }, 60_000);
  }
});
